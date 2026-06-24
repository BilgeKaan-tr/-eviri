// Çok çekirdekli (paralel) eğitim: korpusu N parçaya böler, her parçayı ayrı
// iş parçacığında eğitir, sonra SAYIM düzeyinde birleştirir.
//
// Kullanim:
//   node scripts/mt-train-parallel.js --tsv data.tsv --out model.json
//   node scripts/mt-train-parallel.js --src en.txt --tgt tr.txt --out m.json --workers 8 --stem --gzip
//
// Düşük RAM (örn. Colab): parçayı küçült + eşzamanlılığı sınırla → OOM olmaz:
//   node scripts/mt-train-parallel.js --tsv k.tsv --out m.json --workers 2 --chunks 20 --mincount 2 --stem --gzip
//   --workers : aynı anda kaç worker (eşzamanlılık; çekirdek sayısı kadar tut)
//   --chunks  : korpus kaç parçaya bölünsün (çok = her parça küçük = az bellek)
//   --heap    : her worker'a azami yığın (MB), varsayılan 4096
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { deserializePhrase, mergeModels, pruneCounts } from "../src/mt/phrase.js";
import { writePhraseModel } from "../src/mt/write-model.js";
import { alignTexts } from "../src/mt/align.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const has = (n) => process.argv.includes(n);

const tsv = arg("--tsv"), srcFile = arg("--src"), tgtFile = arg("--tgt");
const out = arg("--out", "model.json");
const opts = {
  srcLang: arg("--lang", "en"),
  iterations: parseInt(arg("--iter", "15"), 10),
  maxPhrase: parseInt(arg("--maxphrase", "4"), 10),
  minCount: parseInt(arg("--mincount", "1"), 10),
  stem: has("--stem"),
};
const nWorkers = parseInt(arg("--workers", String(os.cpus().length)), 10);
// Her worker'a verilecek azami JS yığını (heap), MB. Büyük parçada IBM-1 tablosu
// varsayılan yığını aşıp "ERR_WORKER_OUT_OF_MEMORY" verebilir → burada büyütülür.
const heapMb = parseInt(arg("--heap", "4096"), 10);

// Veriyi oku
let parallel = [];
if (tsv) {
  for (const line of fs.readFileSync(tsv, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue; const [s, t] = line.split("\t"); if (s && t) parallel.push({ src: s, tgt: t });
  }
} else if (srcFile && tgtFile) {
  parallel = alignTexts(fs.readFileSync(srcFile, "utf8"), fs.readFileSync(tgtFile, "utf8"));
} else { console.error("Hata: --tsv ya da --src/--tgt verin."); process.exit(1); }
if (!parallel.length) { console.error("Hata: cümle çifti yok."); process.exit(1); }

// Eşzamanlılık (aynı anda kaç worker) ile PARÇA SAYISI ayrıdır: düşük RAM'de
// çok sayıda KÜÇÜK parça (--chunks) ama az eşzamanlı worker (--workers) →
// her parça küçük olduğundan worker belleği aşmaz, yine de çekirdekler dolu.
const conc = Math.max(1, Math.min(nWorkers, parallel.length));
const nChunks = Math.max(conc, Math.min(parseInt(arg("--chunks", String(conc)), 10), parallel.length));
const chunks = Array.from({ length: nChunks }, () => []);
parallel.forEach((p, i) => chunks[i % nChunks].push(p));

console.log(`${parallel.length} cümle çifti · ${nChunks} parça · ${conc} eşzamanlı · heap ${heapMb}MB · eğitiliyor...`);
const t0 = Date.now();

// Canlı ilerleme: her parçanın yüzdesini topla, ortalamayı yaz
const fracs = new Array(nChunks).fill(0);
let finished = 0;
function render() {
  const avg = Math.round(fracs.reduce((a, b) => a + b, 0) / nChunks * 100);
  process.stdout.write(`\r  eğitiliyor... %${avg}  (${finished}/${nChunks} parça bitti)   `);
}

function trainChunk(pairs, wi) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("./mt-train-worker.mjs", import.meta.url), {
      type: "module",
      resourceLimits: { maxOldGenerationSizeMb: heapMb }, // worker yığınını büyüt (OOM koruması)
    });
    w.on("message", (m) => {
      if (m.type === "progress") { fracs[m.wi] = m.frac; render(); return; }
      w.terminate();
      if (m.ok) { fracs[wi] = 1; finished++; render(); resolve(m); }
      else reject(new Error(m.error));
    });
    w.on("error", reject);
    w.postMessage({ pairs, opts, wi });
  });
}

// Havuz (pool): en çok `conc` worker aynı anda; kalan parçalar sırada bekler.
// Böylece tepe bellek conc × (parça boyutu) ile sınırlı kalır (tüm parçalar
// birden değil). Bu, ERR_WORKER_OUT_OF_MEMORY'nin asıl çözümüdür.
const results = new Array(nChunks);
let nextChunk = 0;
async function poolWorker() {
  while (nextChunk < nChunks) {
    const wi = nextChunk++;
    results[wi] = await trainChunk(chunks[wi], wi);
    chunks[wi] = null; // işlenen parçanın çiftlerini serbest bırak
  }
}
await Promise.all(Array.from({ length: conc }, () => poolWorker()));
process.stdout.write("\n");

// Parçaları TEK TEK çöz + erit + serbest bırak (hepsini birden açma → tepe bellek düşer).
function* lazyModels() {
  for (let i = 0; i < results.length; i++) {
    const m = deserializePhrase(results[i].json, { lazy: true });
    results[i].json = null; // serbest bırak
    yield m;
  }
}
const merged = mergeModels(lazyModels());
// Tüm korpusta minCount'tan az görülen tekil öbekleri ele (Moses varsayılanı):
// öbek SAYISINI keyfî kırpmaz, yalnızca hizalama gürültüsünü atar; tablo küçülür.
if (opts.minCount > 1) pruneCounts(merged, opts.minCount);
// Akışlı yaz: dev JSON dizesi kurulmaz → 512 MB sınırı yok.
const outP = await writePhraseModel(merged, out, { gzip: has("--gzip") });
const kb = Math.round(fs.statSync(outP).size / 1024);
console.log(`✓ ${outP} (${kb} KB) · ${merged.pcounts.size} öbek · ${((Date.now() - t0) / 1000).toFixed(1)} sn`);
