import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Regresyon: build-mt-bundle.js bir ara turkmorph.js'i dosya listesine
// almıyordu; phrase.js ondan segmentTokens/glueTokens import ettiği için
// üretilen egit.html'de bu fonksiyonlar TANIMSIZ kalıyor ve segment modu
// (segment:true) tarayıcıda ReferenceError ile çöküyordu. Bu test, üretilen
// HTML'lerin turkmorph'u gömdüğünü doğrular.
for (const file of ["egit.html", "cevir-kendi.html"]) {
  test(`bundle: ${file} turkmorph'u gömüyor (segment modu çalışsın)`, (t) => {
    const p = path.join(root, file);
    if (!fs.existsSync(p)) { t.skip(`${file} üretilmemiş`); return; }
    const html = fs.readFileSync(p, "utf8");
    assert.ok(html.includes("===== turkmorph.js ====="), "turkmorph.js bundle'a dahil edilmeli");
    assert.ok(/function glueOne\b/.test(html), "glueOne tanımı gömülü olmalı");
    assert.ok(/function segmentTokens\b/.test(html), "segmentTokens tanımı gömülü olmalı");
  });
}
