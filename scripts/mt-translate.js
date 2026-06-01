// Egitilmis ceviri modeliyle metin cevirir.
//
// Kullanim:
//   node scripts/mt-translate.js --model model.json --text "the cat is big"
//   node scripts/mt-translate.js --model model.json --in girdi.txt
//   echo "the dog is small" | node scripts/mt-translate.js --model model.json
import fs from "node:fs";
import { deserialize, translate } from "../src/mt/engine.js";

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

const modelPath = arg("--model", "model.json");
const text = arg("--text");
const inFile = arg("--in");

if (!fs.existsSync(modelPath)) {
  console.error(`Hata: model bulunamadı: ${modelPath} (önce mt-train.js çalıştırın)`);
  process.exit(1);
}
const model = deserialize(fs.readFileSync(modelPath, "utf8"));

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

const input = text != null ? text : inFile ? fs.readFileSync(inFile, "utf8") : await readStdin();
if (!input.trim()) {
  console.error("Hata: çevrilecek metin yok (--text, --in veya stdin).");
  process.exit(1);
}
console.log(translate(model, input));
