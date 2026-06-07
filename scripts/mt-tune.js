// Çözücü ağırlıklarını bir doğrulama setinde BLEU'ya göre ayarlar ve
// (isteğe bağlı) ayarlı ağırlıkları modele yazar.
//
// Kullanim:
//   node scripts/mt-tune.js --model model.json --dev dev.tsv
//   node scripts/mt-tune.js --model model.json --dev dev.tsv --save
//
// dev.tsv: her satir "kaynak<TAB>referans_türkçe"
import fs from "node:fs";
import { deserializePhrase, serializePhrase } from "../src/mt/phrase.js";
import { tuneWeights } from "../src/mt/tune.js";

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const has = (n) => process.argv.includes(n);
const modelPath = arg("--model", "model.json");
const devPath = arg("--dev");

if (!devPath) { console.error("Hata: --dev dev.tsv verin."); process.exit(1); }
const model = deserializePhrase(fs.readFileSync(modelPath, "utf8"));
const dev = [];
for (const line of fs.readFileSync(devPath, "utf8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  const [src, tgt] = line.split("\t");
  if (src && tgt) dev.push({ src, tgt });
}
if (!dev.length) { console.error("Hata: dev seti boş."); process.exit(1); }

console.log(`${dev.length} doğrulama çifti. Ağırlıklar ayarlanıyor...`);
const { weights, bleu, startBleu } = tuneWeights(model, dev);
console.log(`BLEU: ${(startBleu * 100).toFixed(2)} (varsayılan) -> ${(bleu * 100).toFixed(2)} (ayarlı)`);
console.log(`En iyi ağırlıklar:`, weights);

if (has("--save")) {
  model.weights = weights;
  fs.writeFileSync(modelPath, serializePhrase(model));
  console.log(`✓ Ağırlıklar modele yazıldı: ${modelPath}`);
}
