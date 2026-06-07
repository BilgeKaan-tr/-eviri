import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPhraseModel, translatePhrase, serializePhrase, deserializePhrase,
  mergeModels, mergeDictionary, derivePtable,
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
