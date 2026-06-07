// Eğitilmiş çeviri modeliyle metin çevirir. Model türünü (öbek/kelime)
// JSON içeriğinden otomatik algılar.
//
// Kullanim:
//   node scripts/mt-translate.js --model model.json --text "thank you"
//   node scripts/mt-translate.js --model model.json --in girdi.txt
//   echo "good morning" | node scripts/mt-translate.js --model model.json
import fs from "node:fs";
import zlib from "node:zlib";
import { deserialize, translate as translateWord } from "../src/mt/engine.js";
import { deserializePhrase, translatePhrase } from "../src/mt/phrase.js";

// .gz veya gzip sihirli baytları (0x1f 0x8b) ise açar, yoksa düz okur
function readModelText(p) {
  const buf = fs.readFileSync(p);
  if ((buf[0] === 0x1f && buf[1] === 0x8b) || p.endsWith(".gz")) return zlib.gunzipSync(buf).toString("utf8");
  return buf.toString("utf8");
}

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
const raw = JSON.parse(readModelText(modelPath));
const isPhrase = Array.isArray(raw.pcounts) || Array.isArray(raw.ptable);
const model = isPhrase ? deserializePhrase(raw) : deserialize(raw);
const doTranslate = (txt) => (isPhrase ? translatePhrase(model, txt) : translateWord(model, txt));

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

const input = text != null ? text : inFile ? fs.readFileSync(inFile, "utf8") : await readStdin();
if (!input.trim()) { console.error("Hata: çevrilecek metin yok (--text, --in veya stdin)."); process.exit(1); }
console.log(doTranslate(input));
