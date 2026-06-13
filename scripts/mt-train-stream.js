// Bellek-dostu (akışlı) eğitim: çok büyük TSV'yi satır satır okur, B'lik
// gruplar halinde eğitip çalışan modele artımlı birleştirir. Bellek bir grup
// (+ büyüyen model) ile sınırlı kalır — yüz binlerce cümle için.
//
// Kullanim:
//   node scripts/mt-train-stream.js --tsv buyuk.tsv --out model.json --batch 20000 --gzip
import fs from "node:fs";
import zlib from "node:zlib";
import readline from "node:readline";
import { buildPhraseModel, mergeModels, serializePhrase, prunePhraseModel } from "../src/mt/phrase.js";

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const has = (n) => process.argv.includes(n);

const tsv = arg("--tsv");
const out = arg("--out", "model.json");
const batchSize = parseInt(arg("--batch", "20000"), 10);
const opts = {
  srcLang: arg("--lang", "en"),
  iterations: parseInt(arg("--iter", "15"), 10),
  maxPhrase: parseInt(arg("--maxphrase", "4"), 10),
  // Büyük korpus için varsayılan budama eşiği 2 (bellek + boyut). Küçük veride 1.
  minCount: parseInt(arg("--mincount", "2"), 10),
  stem: has("--stem"),
  segment: has("--segment"),
};
if (!tsv) { console.error("Hata: --tsv buyuk.tsv verin."); process.exit(1); }

let running = null, batch = [], total = 0, batches = 0;
const t0 = Date.now();

function foldBatch() {
  if (!batch.length) return;
  const m = buildPhraseModel(batch, opts);
  // Grup düzeyinde tek görülen gürültülü öbekleri ele (birikim belleğini sınırlar)
  if (opts.minCount > 1) prunePhraseModel(m, { minCount: opts.minCount });
  running = running ? mergeModels([running, m], { derivePtable: false }) : m;
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
if (opts.minCount > 1) prunePhraseModel(running, { minCount: opts.minCount });
const json = serializePhrase(running);
let outP = out;
if (has("--gzip")) { if (!outP.endsWith(".gz")) outP += ".gz"; fs.writeFileSync(outP, zlib.gzipSync(json, { level: 9 })); }
else fs.writeFileSync(outP, json);
const kb = Math.round(fs.statSync(outP).size / 1024);
console.log(`✓ ${outP} (${kb} KB) · ${running.pcounts.size} öbek · ${total} cümle · ${((Date.now() - t0) / 1000).toFixed(1)} sn`);
