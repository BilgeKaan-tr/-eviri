// Bellek-dostu (akışlı) eğitim: çok büyük TSV'yi satır satır okur, B'lik
// gruplar halinde eğitip çalışan modele artımlı birleştirir. Bellek bir grup
// (+ büyüyen model) ile sınırlı kalır — yüz binlerce cümle için.
//
// Kullanim:
//   node scripts/mt-train-stream.js --tsv buyuk.tsv --out model.json --batch 20000 --gzip
import fs from "node:fs";
import zlib from "node:zlib";
import readline from "node:readline";
import { createGzip } from "node:zlib";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { buildPhraseModel, mergeModels } from "../src/mt/phrase.js";

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

// Modeli tek büyük string oluşturmadan doğrudan dosyaya (isteğe bağlı gzip) yazar.
// JSON.stringify tek geçişli olduğundan 1 GB+ modeller V8 string sınırını aşar;
// bu fonksiyon her girdiyi tek tek serileştirerek streame yazar.
async function savePhraseStream(model, outPath, gzipped) {
  const chunks = [];

  function w(s) { chunks.push(Buffer.from(s, "utf8")); }

  function writeMapIter(iter) {
    let first = true;
    for (const entry of iter) {
      if (!first) w(",");
      first = false;
      // Her giriş küçük olduğundan stringify güvenlidir
      w(JSON.stringify(entry));
    }
  }

  w('{"srcLang":'); w(JSON.stringify(model.srcLang));
  w(',"maxPhrase":'); w(String(model.maxPhrase));
  w(',"minCount":'); w(String(model.minCount || 1));
  w(',"maxCand":'); w(String(model.maxCand || 20));
  w(',"weights":'); w(JSON.stringify(model.weights || null));

  // pcounts: Map<src, Map<tgt, [count, lex]>>
  w(',"pcounts":[');
  let firstSrc = true;
  for (const [s, mm] of model.pcounts) {
    if (!firstSrc) w(",");
    firstSrc = false;
    w(JSON.stringify([s, [...mm]]));
  }
  w(']');

  // scounts
  w(',"scounts":[');
  let firstSc = true;
  for (const entry of model.scounts) {
    if (!firstSc) w(",");
    firstSc = false;
    w(JSON.stringify(entry));
  }
  w(']');

  // lm
  w(',"lm":{');
  w('"uni":['); writeMapIter(model.lm.uni); w(']');
  w(',"bi":['); writeMapIter(model.lm.bi); w(']');
  w(',"tri":['); writeMapIter(model.lm.tri || []); w(']');
  w(',"biN1":['); writeMapIter(model.lm.biN1 || []); w(']');
  w(',"triN1":['); writeMapIter(model.lm.triN1 || []); w(']');
  w(',"V":'); w(String(model.lm.V));
  w(',"N":'); w(String(model.lm.N || 0));
  w(',"wb":'); w(model.lm.wb ? "true" : "false");
  w('}}');

  const buf = Buffer.concat(chunks);
  const ws = createWriteStream(outPath);
  if (gzipped) {
    const gz = createGzip({ level: 9 });
    gz.pipe(ws);
    await new Promise((res, rej) => {
      gz.on("error", rej); ws.on("error", rej); ws.on("finish", res);
      gz.end(buf);
    });
  } else {
    await new Promise((res, rej) => {
      ws.on("error", rej); ws.on("finish", res);
      ws.end(buf);
    });
  }
}

let running = null, batch = [], total = 0, batches = 0;
const t0 = Date.now();
const pruneMin = Math.max(2, opts.minCount || 2);

// Birleşimden sonra düşük sayımlı öbekleri sil; belleği sınırlı tutar.
function prunePcounts(pcounts) {
  for (const [s, mm] of pcounts) {
    for (const [t, v] of mm) {
      if (v[0] < pruneMin) mm.delete(t);
    }
    if (mm.size === 0) pcounts.delete(s);
  }
}

function foldBatch() {
  if (!batch.length) return;
  const m = buildPhraseModel(batch, opts);
  running = running ? mergeModels([running, m]) : m;
  prunePcounts(running.pcounts);
  total += batch.length; batches++;
  const phrases = running.pcounts.size;
  process.stdout.write(`\r  ${total} cümle · ${batches} grup · ${phrases} kaynak öbek   `);
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

let outP = out;
const gzipped = has("--gzip");
if (gzipped && !outP.endsWith(".gz")) outP += ".gz";
await savePhraseStream(running, outP, gzipped);
const kb = Math.round(fs.statSync(outP).size / 1024);
console.log(`✓ ${outP} (${kb} KB) · ${running.pcounts.size} öbek · ${total} cümle · ${((Date.now() - t0) / 1000).toFixed(1)} sn`);
