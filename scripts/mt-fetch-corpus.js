// Büyük ÜCRETSIZ EN-TR paralel külliyat indirir ve eğitim için TSV üretir.
// (2 kitap bir SMT motoru için çok azdır; gerçek kalite için on binlerce–
//  milyonlarca cümle çifti gerekir. Kaynak: OPUS — opus.nlpl.eu.)
//
// Kullanim:
//   node scripts/mt-fetch-corpus.js --corpus tatoeba --out korpus.tsv
//   node scripts/mt-fetch-corpus.js --corpus ted --out korpus.tsv --limit 200000
//   node scripts/mt-fetch-corpus.js --corpus opensubtitles --out korpus.tsv --limit 500000
//
// Filtreler (varsayılan açık): boş satır, >500 karakter ve uzunluk oranı
// 0.3–3.5 dışı çiftler elenir. Bittiğinde KAÇ çiftin niçin elendiği yazılır.
// Daha çok çift için gevşet:  --no-filter | --maxlen 1000 | --minratio 0.2 |
// --maxratio 5 | --dedup (yinelenenleri ele).
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
const has = (n) => process.argv.includes(n);
const corpus = arg("--corpus", "tatoeba");
const out = arg("--out", "korpus.tsv");
const limit = parseInt(arg("--limit", "0"), 10); // 0 = sınırsız
// Filtre eşikleri (ayarlanabilir): kaç çiftin niçin elendiğini de raporlarız.
const noFilter = has("--no-filter");               // uzunluk+oran filtrelerini kapat
const maxLen = parseInt(arg("--maxlen", "500"), 10);
const minRatio = parseFloat(arg("--minratio", "0.3"));
const maxRatio = parseFloat(arg("--maxratio", "3.5"));
const dedup = has("--dedup");                       // yinelenen çiftleri ele
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

// İki paralel dosyayı satır-eşli AKIŞLA oku (büyük dosyalarda bellek dostu)
const enIt = readline.createInterface({ input: fs.createReadStream(enPath, "utf8"), crlfDelay: Infinity })[Symbol.asyncIterator]();
const trIt = readline.createInterface({ input: fs.createReadStream(trPath, "utf8"), crlfDelay: Infinity })[Symbol.asyncIterator]();
const w = fs.createWriteStream(out, "utf8");
let kept = 0, seen = 0;
// Elenme nedenleri (yanıtı net görmek için): "geri kalan nerede?"
const drop = { empty: 0, len: 0, ratio: 0, dup: 0 };
const seenSet = dedup ? new Set() : null;
while (true) {
  const a = await enIt.next(), b = await trIt.next();
  if (a.done || b.done) break;
  seen++;
  const en = a.value.replace(/\t/g, " ").trim();
  const tr = b.value.replace(/\t/g, " ").trim();
  if (!en || !tr) { drop.empty++; continue; }
  if (!noFilter) {
    if (en.length > maxLen || tr.length > maxLen) { drop.len++; continue; }      // aşırı uzun satır
    const ratio = en.length / Math.max(1, tr.length);
    if (ratio < minRatio || ratio > maxRatio) { drop.ratio++; continue; }        // dengesiz çift
  }
  if (seenSet) { const key = en + "\t" + tr; if (seenSet.has(key)) { drop.dup++; continue; } seenSet.add(key); }
  w.write(en + "\t" + tr + "\n");
  if (++kept % 50000 === 0) process.stdout.write(`\r  ${kept} çift yazıldı`);
  if (limit && kept >= limit) break;
}
w.end();
await new Promise((r) => w.on("finish", r));
fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write("\n");
console.log(`✓ ${kept} cümle çifti -> ${out}  (${seen} satır tarandı)`);
const totalDropped = drop.empty + drop.len + drop.ratio + drop.dup;
if (totalDropped) {
  console.log(`  elenen ${totalDropped} satır:` +
    ` boş=${drop.empty}` +
    ` · uzun(>${maxLen})=${drop.len}` +
    ` · oran(<${minRatio}|>${maxRatio})=${drop.ratio}` +
    (dedup ? ` · yinelenen=${drop.dup}` : ``));
  console.log(`  daha çok çift için: --no-filter (tüm uzunluk/oran filtrelerini kapat),` +
    ` --maxlen 1000, --maxratio 5 gibi gevşetin.`);
}
console.log(`Şimdi eğit:\n  node scripts/mt-train-parallel.js --tsv ${out} --out model.json --workers ${os.cpus().length} --stem --gzip`);
