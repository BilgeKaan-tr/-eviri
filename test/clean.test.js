import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPair, makeDedup } from "../src/mt/clean.js";

test("cleanPair: iyi çifti normalize edip kabul eder", () => {
  assert.deepEqual(cleanPair("  good  morning ", "günaydın "), ["good morning", "günaydın"]);
});

test("cleanPair: boş tarafı eler", () => {
  assert.equal(cleanPair("", "ev"), null);
  assert.equal(cleanPair("house", "   "), null);
});

test("cleanPair: çevrilmemiş (en===tr) çifti eler", () => {
  assert.equal(cleanPair("OK", "OK"), null);
});

test("cleanPair: HTML/markup artığını eler", () => {
  assert.equal(cleanPair("<i>hi</i> there", "merhaba"), null);
});

test("cleanPair: salt sayı/sembol satırını eler (harf yok)", () => {
  assert.equal(cleanPair("123 456", "789 012"), null);
});

test("cleanPair: dengesiz uzunluk oranını eler", () => {
  // çok uzun EN'e karşı çok kısa TR -> hizalama hatası
  assert.equal(cleanPair("this is a very long english sentence indeed", "ev"), null);
});

test("cleanPair: dengesiz kelime oranını eler", () => {
  assert.equal(cleanPair("a b c d e f g h", "tek"), null);
});

test("cleanPair: aşırı uzun satırı eler", () => {
  assert.equal(cleanPair("x".repeat(600), "y".repeat(600)), null);
});

test("makeDedup: aynı çifti ikinci kez reddeder", () => {
  const seen = makeDedup();
  assert.equal(seen("the house", "ev"), true);
  assert.equal(seen("the house", "ev"), false);     // tekrar
  assert.equal(seen("the car", "araba"), true);     // farklı çift geçer
});
