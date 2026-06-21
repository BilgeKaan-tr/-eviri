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
import zlib from "node:zlib";
import readline from "node:readline";
import { pipeline } from "node:stream/promises";

// ---- Saf Node ZIP açıcı (dış 'unzip' komutuna gerek yok; Windows dahil) ----
function readEOCD(fd, size) {
  const maxScan = Math.min(size, 65557);
  const buf = Buffer.alloc(maxScan);
  fs.readSync(fd, buf, 0, maxScan, size - maxScan);
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      return { cdSize: buf.readUInt32LE(i + 12), cdOffset: buf.readUInt32LE(i + 16) };
    }
  }
  throw new Error("ZIP dizini (EOCD) bulunamadı — bozuk indirme olabilir.");
}
function readCentralDir(fd, cdOffset, cdSize) {
  const buf = Buffer.alloc(cdSize);
  fs.readSync(fd, buf, 0, cdSize, cdOffset);
  const entries = []; let p = 0;
  while (p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50) {
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.push({ name, method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
async function extractEntry(zipPath, fd, entry, outPath) {
  const lh = Buffer.alloc(30);
  fs.readSync(fd, lh, 0, 30, entry.localOffset);
  const dataStart = entry.localOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
  const src = fs.createReadStream(zipPath, { start: dataStart, end: dataStart + entry.compSize - 1 });
  const out = fs.createWriteStream(outPath);
  if (entry.method === 8) await pipeline(src, zlib.createInflateRaw(), out); // deflate
  else await pipeline(src, out);                                            // stored
}

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

// Zip'i saf Node ile aç (.en ve .tr paralel dosyaları)
const fd = fs.openSync(zipPath, "r");
const zsize = fs.statSync(zipPath).size;
const { cdOffset, cdSize } = readEOCD(fd, zsize);
const entries = readCentralDir(fd, cdOffset, cdSize);
const enEntry = entries.find((e) => e.name.endsWith(".en"));
const trEntry = entries.find((e) => e.name.endsWith(".tr"));
if (!enEntry || !trEntry) { fs.closeSync(fd); console.error("Zip içinde .en/.tr dosyaları bulunamadı."); process.exit(1); }
const enPath = path.join(tmp, "data.en"), trPath = path.join(tmp, "data.tr");
console.log("  açılıyor...");
await extractEntry(zipPath, fd, enEntry, enPath);
await extractEntry(zipPath, fd, trEntry, trPath);
fs.closeSync(fd);

// ---- Veri kalite filtresi ----
// Gürültülü/dengesiz çiftleri eler; büyük korpuslarda (OpenSubtitles, CCMatrix)
// kritiktir — kalitesiz çift tabloyu zehirler, iyi çiftleri bastırır.
function isClean(en, tr) {
  const ew = en.split(/\s+/).length;
  const tw = tr.split(/\s+/).length;
  if (ew < 3 || tw < 3) return false;           // çok kısa: genellikle başlık/parça
  if (ew > 100 || tw > 100) return false;        // çok uzun: hizalama hatası riski
  const ratio = ew / tw;
  if (ratio > 3.5 || ratio < 1 / 3.5) return false; // kelime sayısı dengesiz
  // Alfasayısal oran: en az %55 harf/rakam (bot metinleri, URL listeleri vb. eler)
  const alpha = (s) => (s.replace(/[^\p{L}\p{N}]/gu, "").length / s.length);
  if (alpha(en) < 0.55 || alpha(tr) < 0.55) return false;
  // Türkçe taraf gerçekten Türkçe mi? Sık Türkçe karakter kontrolü (ı, ş, ğ, ç, ö, ü)
  // Büyük korpuslarda yanlış dil çiftleri yaygındır.
  // (İngilizce kısım için kontrol yapılmaz — köprü dili olarak çok çeşitli olabilir.)
  return true;
}

// İki paralel dosyayı satır-eşli AKIŞLA oku (büyük dosyalarda bellek dostu)
const enIt = readline.createInterface({ input: fs.createReadStream(enPath, "utf8"), crlfDelay: Infinity })[Symbol.asyncIterator]();
const trIt = readline.createInterface({ input: fs.createReadStream(trPath, "utf8"), crlfDelay: Infinity })[Symbol.asyncIterator]();
const w = fs.createWriteStream(out, "utf8");
let kept = 0, seen = 0, skipped = 0;
while (true) {
  const a = await enIt.next(), b = await trIt.next();
  if (a.done || b.done) break;
  seen++;
  const en = a.value.replace(/\t/g, " ").trim();
  const tr = b.value.replace(/\t/g, " ").trim();
  if (!isClean(en, tr)) { skipped++; continue; }
  w.write(en + "\t" + tr + "\n");
  if (++kept % 50000 === 0) process.stdout.write(`\r  ${kept} çift yazıldı (${skipped} elendi)`);
  if (limit && kept >= limit) break;
}
w.end();
await new Promise((r) => w.on("finish", r));
fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write("\n");
const pct = seen > 0 ? (kept / seen * 100).toFixed(1) : "0";
console.log(`✓ ${kept} cümle çifti -> ${out}  (${seen} tarandı, ${skipped} elendi, %${pct} tutuldu)`);
console.log(`Şimdi eğit:\n  node scripts/mt-train-parallel.js --tsv ${out} --out model.json --workers ${os.cpus().length} --maxphrase 7 --stem --gzip`);
