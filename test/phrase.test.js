import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPhraseModel, translatePhrase, serializePhrase, deserializePhrase,
  mergeModels, mergeDictionary, derivePtable, prunePhraseModel,
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

test("bilinmeyen kelime: karşılaştırma/zarf eki yedeği (-er/-est/-ly)", () => {
  const par = [];
  for (let k = 0; k < 3; k++) {
    par.push({ src: "fast", tgt: "hızlı" });
    par.push({ src: "quick", tgt: "çabuk" });
    par.push({ src: "nice", tgt: "güzel" });
  }
  const m = buildPhraseModel(par, { iterations: 25, maxPhrase: 2 });
  assert.equal(translatePhrase(m, "faster", { reorder: false }), "Hızlı");   // -er -> fast
  assert.equal(translatePhrase(m, "fastest", { reorder: false }), "Hızlı");  // -est -> fast
  assert.equal(translatePhrase(m, "nicest", { reorder: false }), "Güzel");   // -est (e-sonlu) -> nice
  assert.equal(translatePhrase(m, "quickly", { reorder: false }), "Çabuk");  // -ly -> quick
});

test("prunePhraseModel: düşük-sayımlı öbekleri eler, sık olanı korur", () => {
  const par = [];
  for (let i = 0; i < 3; i++) par.push({ src: "the cat", tgt: "kedi" }); // count 3
  par.push({ src: "the xyz", tgt: "zzz" }); // singleton
  const m = buildPhraseModel(par, { iterations: 10, maxPhrase: 2 });
  prunePhraseModel(m, { minCount: 2 });
  // singleton kaynak elenmeli, sık öbek korunmalı
  assert.ok(!m.pcounts.has("xyz") && !m.pcounts.has("the xyz"));
  assert.ok([...m.pcounts.keys()].some((k) => k.includes("cat")));
  assert.equal(translatePhrase(m, "the cat"), "Kedi");
});

test("deserializePhrase countsOnly + mergeModels derivePtable:false (bellek-dostu birleştirme)", () => {
  const a = buildPhraseModel([{ src: "good morning", tgt: "günaydın" }, { src: "good morning", tgt: "günaydın" }], { iterations: 12 });
  const co = deserializePhrase(serializePhrase(a), { countsOnly: true });
  assert.equal(co.ptable, undefined, "countsOnly ptable türetmemeli");
  assert.ok(co.pcounts.size > 0);
  const merged = mergeModels([co, co], { derivePtable: false });
  assert.equal(merged.ptable, undefined, "derivePtable:false ptable türetmemeli");
  // serialize→tam deserialize sonrası çeviri çalışmalı (ptable yüklemede türetilir)
  const r = deserializePhrase(serializePhrase(merged));
  assert.equal(translatePhrase(r, "good morning"), "Günaydın");
});

test("Kneser-Ney: yeterli veride devreye girer, çeviriyi bozmaz", () => {
  // Eşiği (tri>=2000) aşacak sentetik korpus üret
  const adj = ["big", "small", "black", "white", "fast", "slow", "new", "old", "nice", "long", "short", "hot", "cold", "clean", "dirty", "blue", "green", "yellow"];
  const trAdj = ["büyük", "küçük", "siyah", "beyaz", "hızlı", "yavaş", "yeni", "eski", "güzel", "uzun", "kısa", "sıcak", "soğuk", "temiz", "kirli", "mavi", "yeşil", "sarı"];
  const noun = ["cat", "dog", "house", "car", "bird", "table", "door", "road"];
  const trNoun = ["kedi", "köpek", "ev", "araba", "kuş", "masa", "kapı", "yol"];
  const par = [];
  for (let i = 0; i < adj.length; i++) for (let j = 0; j < adj.length; j++) {
    if (i === j) continue;
    for (let n = 0; n < noun.length; n++) {
      par.push({ src: `the ${adj[i]} ${adj[j]} ${noun[n]}`, tgt: `${trAdj[i]} ${trAdj[j]} ${trNoun[n]}` });
    }
  }
  const m = buildPhraseModel(par, { iterations: 6, maxPhrase: 3 });
  assert.ok(m.lm.tri.size >= 2000, "yeterli trigram olmalı");
  // KN açık (varsayılan): çeviri doğru ve KN önbelleği kurulmalı
  assert.equal(translatePhrase(m, "the big black cat"), "Büyük siyah kedi");
  assert.ok(m.lm._kn, "KN sürekliik tabloları kurulmalı");
  // KN kapalı (interpolasyon) da çalışmalı (geriye dönük)
  assert.equal(translatePhrase(m, "the big black cat", { kn: false }), "Büyük siyah kedi");
});

test("boş korpus / boş girdi çökmemeli", () => {
  const m = buildPhraseModel([], {});
  assert.equal(m.ptable.size, 0);
  assert.equal(translatePhrase(m, ""), "");
});

test("ters yön özellikleri: ptable 4'lü vektör + tcounts round-trip", () => {
  const par = [
    { src: "the cat is black", tgt: "kedi siyah" },
    { src: "the dog is white", tgt: "köpek beyaz" },
    { src: "the cat is white", tgt: "kedi beyaz" },
  ];
  const m = buildPhraseModel(par, { iterations: 20, maxPhrase: 3 });
  assert.ok(m.tcounts && m.tcounts.size > 0, "tcounts üretilmeli");
  // herhangi bir aday [φfe, lexFE, φef, lexEF] (4 alan) içermeli
  const anyVal = [...[...m.ptable.values()][0].values()][0];
  assert.equal(anyVal.length, 4, "ptable değeri 4 alanlı olmalı");
  // serialize/deserialize tcounts'u korur ve çeviri değişmez
  const r = deserializePhrase(serializePhrase(m));
  assert.ok(r.tcounts && r.tcounts.size === m.tcounts.size);
  assert.equal(translatePhrase(r, "the cat is black"), translatePhrase(m, "the cat is black"));
});

test("derivePtable: tcounts yoksa 2'li (geriye dönük) vektör üretir", () => {
  const pc = new Map([["x", new Map([["a", [2, 0.5]]])]]);
  const sc = new Map([["x", 2]]);
  const pt = derivePtable(pc, sc, {}); // tcounts yok
  assert.equal(pt.get("x").get("a").length, 2);
});

test("derivePtable: minCount nadir öbeği eler", () => {
  const pc = new Map([["x", new Map([["a", [1, 1]], ["b", [3, 1]]])]]);
  const sc = new Map([["x", 4]]);
  const pt = derivePtable(pc, sc, { minCount: 2, maxCand: 20 });
  assert.ok(pt.get("x").has("b"));
  assert.ok(!pt.get("x").has("a"));
});
