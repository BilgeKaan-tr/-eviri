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
import { cleanPair, makeDedup } from "../src/mt/clean.js";
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
// --corpus VIRGÜLLE birden çok korpus alabilir (alanları karıştır: akademik+roman+genel).
// Örn: --corpus wikimatrix,opensubtitles,ted  -> dengeli geniş alanlı korpus.
const corpusArg = arg("--corpus", "tatoeba");
const out = arg("--out", "korpus.tsv");
const limit = parseInt(arg("--limit", "0"), 10); // 0 = sınırsız (TOPLAM)
// --holdout N: korpusa yayılmış N çifti ayrı dev dosyasına ayırır (eğitimden çıkar).
const holdout = parseInt(arg("--holdout", "0"), 10);
const devOut = arg("--dev-out", "data/dev.tsv");

const corpora = corpusArg.split(",").map((x) => x.trim()).filter(Boolean);
for (const c of corpora) {
  if (!CORPORA[c]) { console.error(`Hata: bilinmeyen korpus '${c}'. Seçenekler: ${Object.keys(CORPORA).join(", ")}`); process.exit(1); }
}
// Çok korpusta TOPLAM limit korpus başına bölünür (dengeli karışım)
const perLimit = limit ? Math.ceil(limit / corpora.length) : 0;

// Tek korpusu indir + aç, .en/.tr yollarını döndür
async function downloadExtract(name, tmp) {
  const url = CORPORA[name];
  const zipPath = path.join(tmp, "c.zip");
  console.log(`İndiriliyor: ${name}\n  ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`indirme hatası (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  const fileStream = fs.createWriteStream(zipPath);
  let got = 0;
  for await (const chunk of res.body) {
    got += chunk.length; fileStream.write(chunk);
    if (total) process.stdout.write(`\r  %${Math.round(got / total * 100)} (${(got / 1048576).toFixed(1)} MB)`);
  }
  fileStream.end(); await new Promise((r) => fileStream.on("finish", r)); process.stdout.write("\n");
  const fd = fs.openSync(zipPath, "r");
  const { cdOffset, cdSize } = readEOCD(fd, fs.statSync(zipPath).size);
  const entries = readCentralDir(fd, cdOffset, cdSize);
  const enEntry = entries.find((e) => e.name.endsWith(".en"));
  const trEntry = entries.find((e) => e.name.endsWith(".tr"));
  if (!enEntry || !trEntry) { fs.closeSync(fd); throw new Error("zip içinde .en/.tr yok"); }
  const enPath = path.join(tmp, "data.en"), trPath = path.join(tmp, "data.tr");
  console.log("  açılıyor...");
  await extractEntry(zipPath, fd, enEntry, enPath);
  await extractEntry(zipPath, fd, trEntry, trPath);
  fs.closeSync(fd);
  return { enPath, trPath };
}

const w = fs.createWriteStream(out, "utf8");
let devW = null;
if (holdout > 0) { fs.mkdirSync(path.dirname(devOut), { recursive: true }); devW = fs.createWriteStream(devOut, "utf8"); }
let kept = 0, devKept = 0, acc = 0, dups = 0;
const seenPair = makeDedup();   // korpuslar arası da tekilleştir

for (const name of corpora) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opus-"));
  let keptThis = 0;
  try {
    const { enPath, trPath } = await downloadExtract(name, tmp);
    const enIt = readline.createInterface({ input: fs.createReadStream(enPath, "utf8"), crlfDelay: Infinity })[Symbol.asyncIterator]();
    const trIt = readline.createInterface({ input: fs.createReadStream(trPath, "utf8"), crlfDelay: Infinity })[Symbol.asyncIterator]();
    while (true) {
      const a = await enIt.next(), b = await trIt.next();
      if (a.done || b.done) break;
      const cleaned = cleanPair(a.value, b.value);                 // boş/uzun/dengesiz/HTML/çevrilmemiş ele
      if (!cleaned) continue;
      const [en, tr] = cleaned;
      if (!seenPair(en, tr)) { dups++; continue; }                 // tekrarı ele
      acc++;
      if (devW && devKept < holdout && acc % 100 === 0) { devW.write(en + "\t" + tr + "\n"); devKept++; continue; }
      w.write(en + "\t" + tr + "\n"); kept++; keptThis++;
      if (kept % 50000 === 0) process.stdout.write(`\r  toplam ${kept} çift yazıldı`);
      if (perLimit && keptThis >= perLimit) break;
    }
    process.stdout.write("\n");
    console.log(`  ✓ ${name}: ${keptThis} çift`);
  } catch (e) {
    console.error(`  ! ${name} atlandı: ${(e && e.message) || e}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
w.end(); await new Promise((r) => w.on("finish", r));
if (devW) { devW.end(); await new Promise((r) => devW.on("finish", r)); }
process.stdout.write("\n");
console.log(`✓ TOPLAM ${kept} cümle çifti -> ${out}  (elenen tekrar: ${dups})`);
if (devW) console.log(`✓ ${devKept} doğrulama çifti -> ${devOut} (eğitimden ayrıldı)`);
console.log(`Şimdi eğit (bellek-dostu, kaliteli):\n  node scripts/mt-train-stream.js --tsv ${out} --out model.json --batch 30000 --iter 8 --maxphrase 6 --mincount 2 --segment --gzip`);
