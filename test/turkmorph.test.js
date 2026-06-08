import { test } from "node:test";
import assert from "node:assert/strict";
import { glueOne, segmentWord, segmentTokens, glueTokens } from "../src/mt/turkmorph.js";
import { buildPhraseModel, translatePhrase, serializePhrase, deserializePhrase } from "../src/mt/phrase.js";

test("glueOne: ünlü uyumlu ek üretimi", () => {
  assert.equal(glueOne("ev", ["+LER", "+LOC"]), "evlerde");
  assert.equal(glueOne("kitap", ["+LER", "+ABL"]), "kitaplardan");
  assert.equal(glueOne("araba", ["+DAT"]), "arabaya");   // ünlüden sonra kaynaştırma -y-
  assert.equal(glueOne("göz", ["+LOC"]), "gözde");        // ince ünlü
  assert.equal(glueOne("kapı", ["+ACC"]), "kapıyı");
  assert.equal(glueOne("ev", ["+POSS"]), "evi");
});

test("segmentTokens → glueTokens: KAYIPSIZ round-trip (çıktıyı bozmaz)", () => {
  const words = [
    "evlerde", "kitaplardan", "arabaya", "gözde", "kapıyı", "evlerin",
    "arabaların", "güzel", "bilgisayarları", "ev", "kod", "web", "ders",
    "okuldan", "şehirde", "yıllarca",
  ];
  for (const w of words) {
    const back = glueTokens(segmentTokens([w])).join("");
    assert.equal(back, w, `round-trip kayıpsız olmalı: ${w} -> ${back}`);
  }
});

test("segmentWord: kısa/ASCII/sayı kelimeler dokunulmaz", () => {
  assert.deepEqual(segmentTokens(["ev"]), ["ev"]);       // < 4 harf
  assert.deepEqual(segmentTokens(["2024"]), ["2024"]);   // sayı
  assert.deepEqual(segmentTokens(["http://x.io"]), ["http://x.io"]); // ASCII/URL
});

test("segment modu: model ekleri bağımsız öğrenir + üretir (uçtan uca)", () => {
  const par = [
    { src: "the house", tgt: "ev" },
    { src: "in the house", tgt: "evde" },
    { src: "the houses", tgt: "evler" },
    { src: "to the house", tgt: "eve" },
    { src: "in the car", tgt: "arabada" },
    { src: "the cars", tgt: "arabalar" },
  ];
  const m = buildPhraseModel(par, { iterations: 40, maxPhrase: 3, segment: true });
  assert.equal(m.segmented, true);
  // hedef öbeklerde soyut ek etiketleri görülmeli
  let hasTag = false;
  for (const mm of m.ptable.values()) for (const t of mm.keys()) if (/\+[A-Z]+/.test(t)) hasTag = true;
  assert.ok(hasTag, "model soyut ek etiketleri öğrenmeli");
  // çıktı birleştirilmiş (etiketsiz) yüzey biçim olmalı
  const out = translatePhrase(m, "in the house");
  assert.ok(!/\+/.test(out), "çıktıda ham ek etiketi kalmamalı");
  // serialize/deserialize segmented bayrağını ve davranışı korur
  const r = deserializePhrase(serializePhrase(m));
  assert.equal(r.segmented, true);
  assert.equal(translatePhrase(r, "in the house"), out);
});
