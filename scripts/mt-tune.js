// Çözücü ağırlıklarını bir doğrulama setinde BLEU/chrF'e göre ayarlar ve
// (isteğe bağlı) ayarlı ağırlıkları modele yazar. Gzip (.gz) modelleri destekler.
//
// Kullanim:
//   node scripts/mt-tune.js --model model.json --dev dev.tsv
//   node scripts/mt-tune.js --model model.json.gz --dev dev.tsv --metric chrf --save
//
// dev.tsv: her satir "kaynak<TAB>referans_türkçe"
import fs from "node:fs";
import zlib from "node:zlib";
import { deserializePhrase, serializePhrase } from "../src/mt/phrase.js";
import { tuneWeights } from "../src/mt/tune.js";

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const has = (n) => process.argv.includes(n);
const modelPath = arg("--model", "model.json");
const devPath = arg("--dev");
const metric = arg("--metric", "chrf"); // Türkçe için varsayılan chrF (BLEU'dan güvenilir)

if (!devPath) { console.error("Hata: --dev dev.tsv verin."); process.exit(1); }

// .gz / gzip sihirli baytı (0x1f 0x8b) ise açar, yoksa düz okur
function readModelText(p) {
  const buf = fs.readFileSync(p);
  if ((buf[0] === 0x1f && buf[1] === 0x8b) || p.endsWith(".gz")) return zlib.gunzipSync(buf).toString("utf8");
  return buf.toString("utf8");
}
const isGz = modelPath.endsWith(".gz") || (() => { const b = fs.readFileSync(modelPath); return b[0] === 0x1f && b[1] === 0x8b; })();

const model = deserializePhrase(readModelText(modelPath));
const dev = [];
for (const line of fs.readFileSync(devPath, "utf8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  const [src, tgt] = line.split("\t");
  if (src && tgt) dev.push({ src, tgt });
}
if (!dev.length) { console.error("Hata: dev seti boş."); process.exit(1); }

const M = metric.toLowerCase() === "bleu" ? "bleu" : "chrf";
console.log(`${dev.length} doğrulama çifti. Ağırlıklar ayarlanıyor (${M.toUpperCase()})...`);
const { weights, bleu, startBleu } = tuneWeights(model, dev, { metric: M });
console.log(`${M.toUpperCase()}: ${(startBleu * 100).toFixed(2)} (varsayılan) -> ${(bleu * 100).toFixed(2)} (ayarlı)`);
console.log(`En iyi ağırlıklar:`, weights);

if (has("--save")) {
  model.weights = weights;
  const json = serializePhrase(model);
  if (isGz) fs.writeFileSync(modelPath, zlib.gzipSync(json, { level: 9 }));
  else fs.writeFileSync(modelPath, json);
  console.log(`✓ Ağırlıklar modele yazıldı: ${modelPath}`);
}
