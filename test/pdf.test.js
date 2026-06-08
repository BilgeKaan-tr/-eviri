import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fontPath = path.join(__dirname, "..", "assets", "fonts", "DejaVuSans.ttf");
const hasFont = fs.existsSync(fontPath); // font yoksa (CI 'npm run setup' atlanmışsa) testi atla

// build.js/extract.js modül-üstünde pdf-lib & pdfjs-dist import eder; bağımlılık
// kurulu değilse import patlardı. Dinamik import + try ile bu durumda dosya
// ÇÖKMEK yerine zarifçe atlanır (yerel geliştirmede 'npm install' yapılmamışsa).
let mods = null;
try {
  const [build, extract] = await Promise.all([import("../src/build.js"), import("../src/extract.js")]);
  mods = { buildPdf: build.buildPdf, extractPdf: extract.extractPdf, orderByColumns: extract.orderByColumns };
} catch {
  mods = null;
}
const ready = hasFont && mods; // PDF üretme/çıkarma testleri için hem font hem bağımlılık gerekir

test("build+extract round-trip: metin + Türkçe karakter + blok korunur", { skip: !ready }, async () => {
  const pages = [{
    width: 595, height: 842, blocks: [
      { text: "BÖLÜM 1: GİRİŞ", scale: 1.9, heading: true },
      { text: "Gövde paragrafı. Türkçe: ğ ş ı İ ç ö ü.", scale: 1, heading: false },
    ],
  }];
  const bytes = await mods.buildPdf(pages);
  assert.ok(bytes.length > 1000, "PDF üretilmeli");
  const { pages: p } = await mods.extractPdf(Buffer.from(bytes));
  const t = p.flatMap((pg) => pg.blocks.map((b) => b.text)).join(" ");
  assert.match(t, /BÖLÜM 1: GİRİŞ/);
  assert.match(t, /ğ ş ı İ ç ö ü/);
});

test("extract: maxPages limiti çok uzun PDF'i reddeder", { skip: !ready }, async () => {
  const pages = Array.from({ length: 3 }, () => ({ width: 595, height: 842, blocks: [{ text: "x", scale: 1, heading: false }] }));
  const bytes = await mods.buildPdf(pages);
  await assert.rejects(() => mods.extractPdf(Buffer.from(bytes), { maxPages: 2 }), /çok uzun/);
});

test("orderByColumns: iki sütunlu düzende sol sütun önce gelir", { skip: !mods }, () => {
  // Sayfa genişliği 600, orta=300. İki sütun: sol (x~50), sağ (x~350).
  // pdf.js sırası satır satır iç içe (L1, R1, L2, R2 ...) gelsin.
  const it = (x, y, s) => ({ str: s, width: 100, transform: [1, 0, 0, 1, x, y] });
  const items = [
    it(50, 700, "sol-1"), it(350, 700, "sag-1"),
    it(50, 680, "sol-2"), it(350, 680, "sag-2"),
    it(50, 660, "sol-3"), it(350, 660, "sag-3"),
  ];
  const ordered = mods.orderByColumns(items, 600).map((i) => i.str);
  assert.deepEqual(ordered, ["sol-1", "sol-2", "sol-3", "sag-1", "sag-2", "sag-3"]);
});

test("orderByColumns: tek sütunda (geniş parçalar) doğal sıra korunur", { skip: !mods }, () => {
  const it = (x, y, s) => ({ str: s, width: 400, transform: [1, 0, 0, 1, x, y] });
  const items = [it(100, 700, "a"), it(100, 680, "b"), it(100, 660, "c"), it(100, 640, "d")];
  const ordered = mods.orderByColumns(items, 600).map((i) => i.str);
  assert.deepEqual(ordered, ["a", "b", "c", "d"]);
});
