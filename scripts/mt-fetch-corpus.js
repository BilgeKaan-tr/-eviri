// Büyük ÜCRETSIZ EN-TR paralel külliyat indirir ve eğitim için TSV üretir.
// (2 kitap bir SMT motoru için çok azdır; gerçek kalite için on binlerce–
//  milyonlarca cümle çifti gerekir. Kaynak: OPUS — opus.nlpl.eu.)
//
// Kullanim:
//   node scripts/mt-fetch-corpus.js --corpus tatoeba --out korpus.tsv
//   node scripts/mt-fetch-corpus.js --corpus ted --out korpus.tsv --limit 200000
//   node scripts/mt-fetch-corpus.js --corpus opensubtitles --out korpus.tsv --limit 500000
//
// Sonra:  node scripts/mt-train-parallel.js --tsv korpus.tsv --out model.json --workers 8 --stem --gzip
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { execFileSync } from "node:child_process";

// OPUS "moses" zip'leri: içinde <Korpus>.en-tr.en ve .tr paralel dosyaları var
const CORPORA = {
  tatoeba:       "https://object.pouta.csc.fi/OPUS-Tatoeba/v2023-04-12/moses/en-tr.txt.zip",
  ted:           "https://object.pouta.csc.fi/OPUS-TED2020/v1/moses/en-tr.txt.zip",
  wikimatrix:    "https://object.pouta.csc.fi/OPUS-WikiMatrix/v1/moses/en-tr.txt.zip",
  qed:           "https://object.pouta.csc.fi/OPUS-QED/v2.0a/moses/en-tr.txt.zip",
  opensubtitles: "https://object.pouta.csc.fi/OPUS-OpenSubtitles/v2018/moses/en-tr.txt.zip",
  ccmatrix:      "https://object.pouta.csc.fi/OPUS-CCMatrix/v1/moses/en-tr.txt.zip",
};

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const corpus = arg("--corpus", "tatoeba");
const out = arg("--out", "korpus.tsv");
const limit = parseInt(arg("--limit", "0"), 10); // 0 = sınırsız
const url = CORPORA[corpus];
if (!url) {
  console.error(`Hata: bilinmeyen korpus '${corpus}'. Seçenekler: ${Object.keys(CORPORA).join(", ")}`);
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opus-"));
const zipPath = path.join(tmp, "c.zip");

console.log(`İndiriliyor: ${corpus}\n  ${url}`);
const res = await fetch(url);
if (!res.ok) { console.error(`İndirme hatası (HTTP ${res.status}). İnternet/erişim kontrol edin.`); process.exit(1); }
const total = Number(res.headers.get("content-length")) || 0;
const fileStream = fs.createWriteStream(zipPath);
let got = 0;
for await (const chunk of res.body) {
  got += chunk.length; fileStream.write(chunk);
  if (total) process.stdout.write(`\r  %${Math.round(got / total * 100)} (${(got / 1048576).toFixed(1)} MB)`);
}
fileStream.end();
await new Promise((r) => fileStream.on("finish", r));
process.stdout.write("\n");

execFileSync("unzip", ["-o", "-j", zipPath, "-d", tmp], { stdio: "ignore" });
const files = fs.readdirSync(tmp);
const enFile = files.find((f) => f.endsWith(".en"));
const trFile = files.find((f) => f.endsWith(".tr"));
if (!enFile || !trFile) { console.error("Zip içinde .en/.tr dosyaları bulunamadı."); process.exit(1); }

// İki paralel dosyayı satır-eşli AKIŞLA oku (büyük dosyalarda bellek dostu)
const enIt = readline.createInterface({ input: fs.createReadStream(path.join(tmp, enFile), "utf8"), crlfDelay: Infinity })[Symbol.asyncIterator]();
const trIt = readline.createInterface({ input: fs.createReadStream(path.join(tmp, trFile), "utf8"), crlfDelay: Infinity })[Symbol.asyncIterator]();
const w = fs.createWriteStream(out, "utf8");
let kept = 0, seen = 0;
while (true) {
  const a = await enIt.next(), b = await trIt.next();
  if (a.done || b.done) break;
  seen++;
  const en = a.value.replace(/\t/g, " ").trim();
  const tr = b.value.replace(/\t/g, " ").trim();
  if (!en || !tr) continue;
  if (en.length > 500 || tr.length > 500) continue;            // aşırı uzun satır ele
  const ratio = en.length / Math.max(1, tr.length);
  if (ratio < 0.3 || ratio > 3.5) continue;                    // dengesiz çift ele
  w.write(en + "\t" + tr + "\n");
  if (++kept % 50000 === 0) process.stdout.write(`\r  ${kept} çift yazıldı`);
  if (limit && kept >= limit) break;
}
w.end();
await new Promise((r) => w.on("finish", r));
fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write("\n");
console.log(`✓ ${kept} cümle çifti -> ${out}  (${seen} satır tarandı)`);
console.log(`Şimdi eğit:\n  node scripts/mt-train-parallel.js --tsv ${out} --out model.json --workers ${os.cpus().length} --stem --gzip`);
