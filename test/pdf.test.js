import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPdf } from "../src/build.js";
import { extractPdf } from "../src/extract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fontPath = path.join(__dirname, "..", "assets", "fonts", "DejaVuSans.ttf");
const hasFont = fs.existsSync(fontPath); // font yoksa (CI 'npm run setup' atlanmışsa) testi atla

test("build+extract round-trip: metin + Türkçe karakter + blok korunur", { skip: !hasFont }, async () => {
  const pages = [{
    width: 595, height: 842, blocks: [
      { text: "BÖLÜM 1: GİRİŞ", scale: 1.9, heading: true },
      { text: "Gövde paragrafı. Türkçe: ğ ş ı İ ç ö ü.", scale: 1, heading: false },
    ],
  }];
  const bytes = await buildPdf(pages);
  assert.ok(bytes.length > 1000, "PDF üretilmeli");
  const { pages: p } = await extractPdf(Buffer.from(bytes));
  const t = p.flatMap((pg) => pg.blocks.map((b) => b.text)).join(" ");
  assert.match(t, /BÖLÜM 1: GİRİŞ/);
  assert.match(t, /ğ ş ı İ ç ö ü/);
});

test("extract: maxPages limiti çok uzun PDF'i reddeder", { skip: !hasFont }, async () => {
  const pages = Array.from({ length: 3 }, () => ({ width: 595, height: 842, blocks: [{ text: "x", scale: 1, heading: false }] }));
  const bytes = await buildPdf(pages);
  await assert.rejects(() => extractPdf(Buffer.from(bytes), { maxPages: 2 }), /çok uzun/);
});
