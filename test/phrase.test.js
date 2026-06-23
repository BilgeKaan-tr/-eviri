import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPhraseModel, translatePhrase, serializePhrase, serializePhraseChunks, deserializePhrase,
  mergeModels, mergeDictionary, derivePtable, pruneCounts, cloneModelCounts,
} from "../src/mt/phrase.js";

const sample = [
  { src: "good morning", tgt: "günaydın" },
  { src: "good night", tgt: "iyi geceler" },
  { src: "thank you", tgt: "teşekkür ederim" },
  { src: "thank you very much", tgt: "çok teşekkür ederim" },
];

test("buildPhraseModel: çok-kelimeli öbek öğrenir", () => {
  const m = buildPhraseModel(sample, { iterations: 30 });
  assert.equal(translatePhrase(m, "thank you"), "Teşekkür ederim");
  assert.equal(translatePhrase(m, "good night"), "İyi geceler");
});

test("serialize/deserialize: lex + sayım korunur, çeviri aynı", () => {
  const m = buildPhraseModel(sample, { iterations: 25 });
  const before = translatePhrase(m, "thank you very much");
  const r = deserializePhrase(serializePhrase(m));
  assert.ok(r.pcounts.size > 0);
  assert.equal(translatePhrase(r, "thank you very much"), before);
});

test("serializePhraseChunks: birleştirilince serializePhrase ile birebir aynı", () => {
  const m = buildPhraseModel(sample, { iterations: 25 });
  const whole = serializePhrase(m);
  let streamed = "";
  for (const part of serializePhraseChunks(m)) streamed += part;
  assert.equal(streamed, whole); // 512 MB dize sınırına takılmadan aynı çıktı
  // ve geçerli JSON + round-trip
  assert.deepEqual(JSON.parse(streamed).srcLang, m.srcLang);
  const r = deserializePhrase(streamed);
  assert.equal(translatePhrase(r, "thank you"), translatePhrase(m, "thank you"));
});

test("deserializePhrase lazy: trie/ptable kurmaz ama sayımlar gelir", () => {
  const m = buildPhraseModel(sample, { iterations: 20 });
  const lazy = deserializePhrase(serializePhrase(m), { lazy: true });
  assert.ok(lazy.pcounts.size > 0);
  assert.equal(lazy._trie, undefined);
  assert.equal(lazy.ptable, undefined);
});

test("mergeModels: üreteç (generator) ile de çalışır (tek tek eritme)", () => {
  const j1 = serializePhrase(buildPhraseModel([{ src: "good morning", tgt: "günaydın" }], { iterations: 20 }));
  const j2 = serializePhrase(buildPhraseModel([{ src: "thank you", tgt: "teşekkürler" }], { iterations: 20 }));
  const jsons = [j1, j2];
  function* lazyModels(){ for (let i = 0; i < jsons.length; i++) { const m = deserializePhrase(jsons[i], { lazy: true }); jsons[i] = null; yield m; } }
  const merged = mergeModels(lazyModels());
  assert.ok(merged.pcounts.has("good morning") || merged.pcounts.has("good"));
  assert.equal(merged.srcLang, "en");
});

test("pruneCounts: tekil öbeği eler, sık öbeği korur", () => {
  const m = buildPhraseModel([
    ...Array(3).fill({ src: "thank you", tgt: "teşekkürler" }), // sayım 3
    { src: "rare phrase", tgt: "nadir öbek" },                  // sayım 1
  ], { iterations: 15 });
  const before = m.pcounts.size;
  pruneCounts(m, 2);
  assert.ok(m.pcounts.size < before);             // bir şeyler atıldı
  assert.ok(m.pcounts.has("thank you"));          // sık öbek korunur
  assert.ok(!m.pcounts.has("rare phrase"));       // tekil öbek elendi
  assert.ok(m.ptable.has("thank you"));           // ptable yeniden türetildi
});

test("cloneModelCounts: kopya bağımsız, base bozulmaz", () => {
  const base = buildPhraseModel(sample, { iterations: 20 });
  const clone = cloneModelCounts(base);
  mergeDictionary(clone, [{ src: "hello", tgt: "merhaba" }]);
  assert.ok(clone.pcounts.has("hello"));
  assert.ok(!base.pcounts.has("hello")); // base etkilenmedi
});

test("mergeModels: iki korpus birleşir, ikisini de çevirir", () => {
  const m1 = buildPhraseModel([{ src: "good morning", tgt: "günaydın" }], { iterations: 20 });
  const m2 = buildPhraseModel([{ src: "good night", tgt: "iyi geceler" }], { iterations: 20 });
  const merged = mergeModels([m1, m2]);
  assert.equal(translatePhrase(merged, "good morning"), "Günaydın");
  assert.equal(translatePhrase(merged, "good night"), "İyi geceler");
});

test("mergeDictionary: bilinmeyen kelime çevrilir, çift uygulanmaz", () => {
  const base = serializePhrase(buildPhraseModel(sample, { iterations: 15 }));
  const m1 = deserializePhrase(base); mergeDictionary(m1, [{ src: "computer", tgt: "bilgisayar" }]);
  assert.equal(translatePhrase(m1, "computer"), "Bilgisayar");
  // base'den tekrar türetince sayım aynı kalır (çift uygulama yok)
  const a = deserializePhrase(base); mergeDictionary(a, [{ src: "computer", tgt: "bilgisayar" }]);
  const b = deserializePhrase(base); mergeDictionary(b, [{ src: "computer", tgt: "bilgisayar" }]);
  assert.equal(a.pcounts.get("computer").get("bilgisayar")[0], b.pcounts.get("computer").get("bilgisayar")[0]);
});

test("bilinmeyen kelime: İngilizce lemma yedeği (çoğul -> tekil)", () => {
  const nouns = { car: "araba", book: "kitap", city: "şehir" };
  const par = [];
  for (const [n, tn] of Object.entries(nouns)) { for (let k = 0; k < 3; k++) par.push({ src: n, tgt: tn }); }
  const m = buildPhraseModel(par, { iterations: 25, maxPhrase: 2 });
  assert.equal(translatePhrase(m, "books", { reorder: false }), "Kitap");   // book
  assert.equal(translatePhrase(m, "cities", { reorder: false }), "Şehir");  // ies->y
});

test("boş korpus / boş girdi çökmemeli", () => {
  const m = buildPhraseModel([], {});
  assert.equal(m.ptable.size, 0);
  assert.equal(translatePhrase(m, ""), "");
});

test("derivePtable: minCount nadir öbeği eler", () => {
  const pc = new Map([["x", new Map([["a", [1, 1]], ["b", [3, 1]]])]]);
  const sc = new Map([["x", 4]]);
  const pt = derivePtable(pc, sc, { minCount: 2, maxCand: 20 });
  assert.ok(pt.get("x").has("b"));
  assert.ok(!pt.get("x").has("a"));
});
