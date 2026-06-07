// Birden çok eğitilmiş öbek modelini SAYIM düzeyinde tek modelde birleştirir.
// (20.000 kitabı parça parça eğitip toplamak için.)
//
// Kullanim:
//   node scripts/mt-merge.js --out birlesik.json model1.json model2.json ...
import fs from "node:fs";
import zlib from "node:zlib";
import { deserializePhrase, mergeModels, serializePhrase } from "../src/mt/phrase.js";

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const out = arg("--out", "birlesik.json");
// --out ve değeri dışındaki tüm .json/.gz argümanları girdi modelleridir
const inputs = process.argv.slice(2).filter(
  (a) => (a.endsWith(".json") || a.endsWith(".json.gz") || a.endsWith(".gz")) && a !== out
);
if (inputs.length < 2) {
  console.error("Hata: en az iki model.json verin. Örn: --out b.json a1.json a2.json");
  process.exit(1);
}

const models = inputs.map((p) => {
  const buf = fs.readFileSync(p);
  const txt = ((buf[0]===0x1f&&buf[1]===0x8b)||p.endsWith(".gz")) ? zlib.gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  const m = deserializePhrase(txt);
  if (!m.pcounts) {
    console.error(`Hata: ${p} eski biçim (sayım yok), birleştirilemez. Yeniden eğitin.`);
    process.exit(1);
  }
  return m;
});

const merged = mergeModels(models);
const mjson = serializePhrase(merged);
let outP = out;
if (process.argv.includes("--gzip")) { if(!outP.endsWith(".gz")) outP += ".gz"; fs.writeFileSync(outP, zlib.gzipSync(mjson, {level:9})); }
else fs.writeFileSync(outP, mjson);
const kb = Math.round(fs.statSync(outP).size / 1024);
console.log(`✓ ${inputs.length} model birleştirildi -> ${outP} (${kb} KB)`);
console.log(`  toplam öbek: ${merged.pcounts.size}, LM kelime: ${merged.lm.V}`);
