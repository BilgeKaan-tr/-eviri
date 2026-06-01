// Paralel metinden ceviri modeli egitir ve JSON olarak kaydeder.
//
// Kullanim:
//   node scripts/mt-train.js --tsv data.tsv --out model.json
//   node scripts/mt-train.js --src en.txt --tgt tr.txt --out model.json
//
// Bicim:
//   --tsv : her satir "kaynak<TAB>turkce" (hizalanmis cumle ciftleri)
//   --src/--tgt : iki ayri dosya; i. satir <-> i. satir hizali olmali
import fs from "node:fs";
import { buildModel, serialize } from "../src/mt/engine.js";

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

const tsv = arg("--tsv");
const srcFile = arg("--src");
const tgtFile = arg("--tgt");
const out = arg("--out", "model.json");
const srcLang = arg("--lang", "en");
const iterations = parseInt(arg("--iter", "15"), 10);

let parallel = [];
if (tsv) {
  for (const line of fs.readFileSync(tsv, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [src, tgt] = line.split("\t");
    if (src && tgt) parallel.push({ src, tgt });
  }
} else if (srcFile && tgtFile) {
  const s = fs.readFileSync(srcFile, "utf8").split(/\r?\n/);
  const t = fs.readFileSync(tgtFile, "utf8").split(/\r?\n/);
  const n = Math.min(s.length, t.length);
  for (let i = 0; i < n; i++) {
    if (s[i].trim() && t[i].trim()) parallel.push({ src: s[i], tgt: t[i] });
  }
} else {
  console.error("Hata: --tsv ya da --src ve --tgt verin.");
  process.exit(1);
}

if (parallel.length === 0) {
  console.error("Hata: hiç cümle çifti okunamadı.");
  process.exit(1);
}

console.log(`${parallel.length} cümle çifti okundu. Eğitiliyor (${iterations} tur)...`);
const t0 = Date.now();
const model = buildModel(parallel, { srcLang, iterations });
fs.writeFileSync(out, serialize(model));
const kb = Math.round(fs.statSync(out).size / 1024);
console.log(`✓ Model kaydedildi: ${out} (${kb} KB) — ${((Date.now() - t0) / 1000).toFixed(1)} sn`);
console.log(`  Öğrenilen kaynak kelime sayısı: ${model.t.size}`);
