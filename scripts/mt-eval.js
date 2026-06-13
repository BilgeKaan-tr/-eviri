// Eğitilmiş modeli bir doğrulama setinde (BLEU) değerlendirir.
//
// Kullanim:
//   node scripts/mt-eval.js --model model.json --dev dev.tsv
//   node scripts/mt-eval.js --model model.json.gz --dev dev.tsv --examples 5
// dev.tsv: her satir "kaynak<TAB>referans_türkçe"
import fs from "node:fs";
import zlib from "node:zlib";
import { deserializePhrase, translatePhrase } from "../src/mt/phrase.js";
import { evaluate, chrf } from "../src/mt/tune.js";

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const modelPath = arg("--model", "model.json");
const devPath = arg("--dev");
const nEx = parseInt(arg("--examples", "3"), 10);

if (!devPath) { console.error("Hata: --dev dev.tsv verin."); process.exit(1); }
function readModelText(p) {
  const buf = fs.readFileSync(p);
  if ((buf[0] === 0x1f && buf[1] === 0x8b) || p.endsWith(".gz")) return zlib.gunzipSync(buf).toString("utf8");
  return buf.toString("utf8");
}
const model = deserializePhrase(readModelText(modelPath));
const dev = [];
for (const line of fs.readFileSync(devPath, "utf8").split(/\r?\n/)) {
  if (!line.trim()) continue; const [s, t] = line.split("\t"); if (s && t) dev.push({ src: s, tgt: t });
}
if (!dev.length) { console.error("Hata: dev seti boş."); process.exit(1); }

const w = model.weights || {};
const bleu = evaluate(model, dev, w, "bleu");
const cf = chrf(dev.map((d) => translatePhrase(model, d.src, w)), dev.map((d) => d.tgt));
// chrF (karakter n-gram F2) sondan eklemeli Türkçe için daha güvenilir bir ölçü
console.log(`${dev.length} doğrulama çifti · BLEU: ${(bleu * 100).toFixed(2)} · chrF: ${(cf * 100).toFixed(2)}`);
console.log("\nÖrnek çeviriler:");
for (const d of dev.slice(0, nEx)) {
  console.log(`  kaynak  : ${d.src}`);
  console.log(`  model   : ${translatePhrase(model, d.src)}`);
  console.log(`  referans: ${d.tgt}\n`);
}
