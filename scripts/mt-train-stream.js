// Bellek-dostu (akışlı) eğitim: çok büyük TSV'yi satır satır okur, B'lik
// gruplar halinde eğitip çalışan modele artımlı birleştirir. Bellek bir grup
// (+ büyüyen model) ile sınırlı kalır — yüz binlerce cümle için.
//
// Kullanim:
//   node scripts/mt-train-stream.js --tsv buyuk.tsv --out model.json --batch 20000 --gzip
import fs from "node:fs";
import readline from "node:readline";
import { buildPhraseModel, mergeModels, pruneCounts } from "../src/mt/phrase.js";
import { writePhraseModel } from "../src/mt/write-model.js";

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const has = (n) => process.argv.includes(n);

const tsv = arg("--tsv");
const out = arg("--out", "model.json");
const batchSize = parseInt(arg("--batch", "20000"), 10);
const opts = {
  srcLang: arg("--lang", "en"),
  iterations: parseInt(arg("--iter", "15"), 10),
  maxPhrase: parseInt(arg("--maxphrase", "4"), 10),
  minCount: parseInt(arg("--mincount", "1"), 10),
  stem: has("--stem"),
};
if (!tsv) { console.error("Hata: --tsv buyuk.tsv verin."); process.exit(1); }

let running = null, batch = [], total = 0, batches = 0;
const t0 = Date.now();

function foldBatch() {
  if (!batch.length) return;
  const m = buildPhraseModel(batch, opts);
  // derive:false → her grupta ptable kurma (sondaki tek derive yeter); ara
  // ptable'lar büyük korpusta gereksiz CPU+bellektir.
  running = running ? mergeModels([running, m], { derive: false }) : m;
  total += batch.length; batches++;
  process.stdout.write(`\r  ${total} cümle · ${batches} grup işlendi`);
  batch = [];
}

const rl = readline.createInterface({ input: fs.createReadStream(tsv, "utf8"), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  const i = line.indexOf("\t");
  if (i < 0) continue;
  const src = line.slice(0, i), tgt = line.slice(i + 1);
  if (src && tgt) batch.push({ src, tgt });
  if (batch.length >= batchSize) foldBatch();
}
foldBatch();
process.stdout.write("\n");

if (!running) { console.error("Hata: cümle çifti yok."); process.exit(1); }
// Tüm korpus toplandıktan sonra tekil öbekleri ele (sayım<minCount).
if (opts.minCount > 1) pruneCounts(running, opts.minCount);
// Akışlı yaz: dev JSON dizesi kurulmaz → 512 MB sınırı yok.
const outP = await writePhraseModel(running, out, { gzip: has("--gzip") });
const kb = Math.round(fs.statSync(outP).size / 1024);
console.log(`✓ ${outP} (${kb} KB) · ${running.pcounts.size} öbek · ${total} cümle · ${((Date.now() - t0) / 1000).toFixed(1)} sn`);
