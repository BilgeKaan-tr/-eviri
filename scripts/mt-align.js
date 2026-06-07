// İki ham metni (düz kaynak + düz Türkçe) otomatik hizalar ve eğitim için
// TSV (kaynak<TAB>türkçe) üretir.
//
// Kullanim:
//   node scripts/mt-align.js --src kitap-en.txt --tgt kitap-tr.txt --out cift.tsv
//   node scripts/mt-train.js --tsv cift.tsv --out model.json
import fs from "node:fs";
import { alignTexts } from "../src/mt/align.js";

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const srcFile = arg("--src");
const tgtFile = arg("--tgt");
const out = arg("--out", "cift.tsv");

if (!srcFile || !tgtFile) {
  console.error("Hata: --src ve --tgt dosyalarını verin.");
  process.exit(1);
}
const srcText = fs.readFileSync(srcFile, "utf8");
const tgtText = fs.readFileSync(tgtFile, "utf8");

const pairs = alignTexts(srcText, tgtText);
const tsv = pairs.map((p) => p.src.replace(/\t/g, " ") + "\t" + p.tgt.replace(/\t/g, " ")).join("\n");
fs.writeFileSync(out, tsv + "\n");
console.log(`✓ ${pairs.length} cümle çifti hizalandı -> ${out}`);
