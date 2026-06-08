// Birden çok eğitilmiş öbek modelini SAYIM düzeyinde tek modelde birleştirir.
// (Var olan modeli boşa harcamadan üstüne yeni korpus eklemek için.)
// Bellek-dostu: modeller TEK TEK, countsOnly (ptable/trie türetmeden) okunup
// artımlı birleştirilir; istenirse düşük-sayımlı öbekler budanır.
//
// Kullanim:
//   node scripts/mt-merge.js --out birlesik.json model1.json model2.json ...
//   node scripts/mt-merge.js --out birlesik.json --mincount 2 --gzip a.json.gz b.json.gz
import fs from "node:fs";
import zlib from "node:zlib";
import { deserializePhrase, mergeModels, serializePhrase, prunePhraseModel } from "../src/mt/phrase.js";

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const out = arg("--out", "birlesik.json");
const minCount = parseInt(arg("--mincount", "1"), 10);
// --out/--mincount değerleri dışındaki tüm .json/.gz argümanları girdi modelleridir
const skip = new Set([out, String(minCount)]);
const inputs = process.argv.slice(2).filter(
  (a) => (a.endsWith(".json") || a.endsWith(".json.gz") || a.endsWith(".gz")) && !skip.has(a)
);
if (inputs.length < 2) {
  console.error("Hata: en az iki model.json verin. Örn: --out b.json a1.json a2.json");
  process.exit(1);
}

function readText(p) {
  const buf = fs.readFileSync(p);
  return ((buf[0] === 0x1f && buf[1] === 0x8b) || p.endsWith(".gz")) ? zlib.gunzipSync(buf).toString("utf8") : buf.toString("utf8");
}

// Modelleri TEK TEK oku → birleştir → serbest bırak (tepe bellek ~1 model + biriken)
let merged = null;
for (const p of inputs) {
  const m = deserializePhrase(readText(p), { countsOnly: true });
  if (!m.pcounts) { console.error(`Hata: ${p} eski biçim (sayım yok), birleştirilemez. Yeniden eğitin.`); process.exit(1); }
  merged = merged ? mergeModels([merged, m], { derivePtable: false }) : m;
  console.log(`  + ${p}`);
}
// İsteğe bağlı budama (birleşik modelde düşük-sayımlı öbekleri ele)
if (minCount > 1) prunePhraseModel(merged, { minCount });

const mjson = serializePhrase(merged);
let outP = out;
if (process.argv.includes("--gzip")) { if (!outP.endsWith(".gz")) outP += ".gz"; fs.writeFileSync(outP, zlib.gzipSync(mjson, { level: 9 })); }
else fs.writeFileSync(outP, mjson);
const kb = Math.round(fs.statSync(outP).size / 1024);
console.log(`✓ ${inputs.length} model birleştirildi -> ${outP} (${kb} KB)`);
console.log(`  toplam öbek: ${merged.pcounts.size}, LM kelime: ${merged.lm.V}`);
