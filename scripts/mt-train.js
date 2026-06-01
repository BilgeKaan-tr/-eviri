// Paralel metinden çeviri modeli eğitir ve JSON olarak kaydeder.
// Varsayılan: ÖBEK-TABANLI (phrase-based) model — en iyi kalite.
//
// Kullanim:
//   node scripts/mt-train.js --tsv data.tsv --out model.json
//   node scripts/mt-train.js --src en.txt --tgt tr.txt --out model.json
//   node scripts/mt-train.js --tsv data.tsv --out m.json --iter 15 --maxphrase 5 --mincount 2
//   node scripts/mt-train.js --tsv data.tsv --out m.json --word     # eski kelime motoru
//
// Bicim:
//   --tsv : her satir "kaynak<TAB>turkce"
//   --src/--tgt : iki ayri dosya; i. satir <-> i. satir hizali
import fs from "node:fs";
import { buildModel, serialize } from "../src/mt/engine.js";
import { buildPhraseModel, serializePhrase } from "../src/mt/phrase.js";

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.includes(name);

const tsv = arg("--tsv");
const srcFile = arg("--src");
const tgtFile = arg("--tgt");
const out = arg("--out", "model.json");
const srcLang = arg("--lang", "en");
const iterations = parseInt(arg("--iter", "15"), 10);
const maxPhrase = parseInt(arg("--maxphrase", "4"), 10);
const minCount = parseInt(arg("--mincount", "1"), 10);
const useWord = has("--word");

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
  for (let i = 0; i < n; i++) if (s[i].trim() && t[i].trim()) parallel.push({ src: s[i], tgt: t[i] });
} else {
  console.error("Hata: --tsv ya da --src ve --tgt verin.");
  process.exit(1);
}
if (parallel.length === 0) { console.error("Hata: hiç cümle çifti okunamadı."); process.exit(1); }

const kind = useWord ? "kelime" : "öbek";
console.log(`${parallel.length} cümle çifti okundu. Eğitiliyor (${kind}-tabanlı, ${iterations} tur)...`);
const t0 = Date.now();

let json, info;
if (useWord) {
  const model = buildModel(parallel, { srcLang, iterations });
  json = serialize(model);
  info = `öğrenilen kaynak kelime: ${model.t.size}`;
} else {
  const model = buildPhraseModel(parallel, { srcLang, iterations, maxPhrase, minCount });
  json = serializePhrase(model);
  info = `öğrenilen öbek sayısı: ${model.ptable.size}`;
}
fs.writeFileSync(out, json);
const kb = Math.round(fs.statSync(out).size / 1024);
console.log(`✓ Model kaydedildi: ${out} (${kb} KB) — ${((Date.now() - t0) / 1000).toFixed(1)} sn`);
console.log(`  ${info}`);
