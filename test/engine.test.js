import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tokenize, detokenize, trLower, splitSentences,
  trainIBM1, trainLM, lmScore3, buildModel, translate, serialize, deserialize,
  restoreCasing, polishPunct,
} from "../src/mt/engine.js";

test("trLower: Türkçe büyük I/İ", () => {
  assert.equal(trLower("İSTANBUL"), "istanbul");
  assert.equal(trLower("IŞIK"), "ışık");
});

test("restoreCasing: özel isim/kısaltma büyük harfi geri gelir", () => {
  // Title-case özel isim (cümle ortasında) olduğu gibi geçince düzeltilir
  assert.equal(restoreCasing("ben london gördüm", "I saw London", "en"), "ben London gördüm");
  // Kısaltma cümle başında bile korunur
  assert.equal(restoreCasing("nasa bir kurum", "NASA is an agency", "en"), "NASA bir kurum");
  // Cümle başı Title-case (özel isim değil) atlanır, değiştirilmez
  assert.equal(restoreCasing("bu güzel bir gün", "The day is nice", "en"), "bu güzel bir gün");
  // Eşleşme yoksa değişmez
  assert.equal(restoreCasing("kedi siyah", "the black cat", "en"), "kedi siyah");
});

test("polishPunct: sarkan/çift noktalama temizlenir, cümle sonu korunur", () => {
  assert.equal(polishPunct("Büyük beyaz köpek ,"), "Büyük beyaz köpek");
  assert.equal(polishPunct("kedi ,, siyah"), "kedi, siyah");
  assert.equal(polishPunct(", baştaki virgül"), "baştaki virgül");
  assert.equal(polishPunct("normal cümle."), "normal cümle.");
  assert.equal(polishPunct("soru ?"), "soru?");
});

test("tokenize: sayı/URL/e-posta atomik kalır", () => {
  assert.deepEqual(tokenize("Pi 3.14 50% at 10:30", "en"), ["pi", "3.14", "50%", "at", "10:30"]);
  assert.deepEqual(tokenize("mail x@y.com link https://a.b/c", "en"), ["mail", "x@y.com", "link", "https://a.b/c"]);
});

test("tokenize: noktalama jetonlanır", () => {
  assert.deepEqual(tokenize("a, (b).", "en"), ["a", ",", "(", "b", ")", "."]);
});

test("splitSentences: cümlelere böler", () => {
  assert.equal(splitSentences("Bir. İki! Üç?").length, 3);
});

test("detokenize: noktalama boşlukları + cümle başı büyütme", () => {
  assert.equal(detokenize(["merhaba", ",", "dünya", "."]), "Merhaba, dünya.");
  assert.equal(detokenize(["(", "test", ")"]), "(test)");
});

test("trainIBM1: kelime hizalamasını öğrenir (EM)", () => {
  const pairs = [
    { e: ["the", "cat"], f: ["kedi"] },
    { e: ["the", "dog"], f: ["köpek"] },
    { e: ["a", "cat"], f: ["kedi"] },
    { e: ["a", "dog"], f: ["köpek"] },
  ];
  const t = trainIBM1(pairs, 30);
  const best = (w) => [...t.get(w).entries()].sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(best("cat"), "kedi");
  assert.equal(best("dog"), "köpek");
});

test("trainIBM1: onIter geri çağrımı her turda çağrılır", () => {
  let calls = 0;
  trainIBM1([{ e: ["a"], f: ["b"] }], 5, () => calls++);
  assert.equal(calls, 5);
});

test("trainLM + lmScore3: trigram olasılığı sonlu ve negatif log", () => {
  const lm = trainLM([["a", "b", "c"], ["a", "b", "d"]]);
  const s = lmScore3(lm, "a", "b", "c");
  assert.ok(Number.isFinite(s) && s < 0);
});

test("decode: trigram geçmişiyle öğrenilen içerik kelimesini üretir", () => {
  // Çözücü iki-kelimelik geçmişle (lmScore3) çalışır; öğrenilen karşılığı
  // hâlâ doğru üretmeli (bigram->trigram yükseltmesi regresyon yapmasın).
  const par = [
    { src: "the cat", tgt: "kedi" },
    { src: "the dog", tgt: "köpek" },
    { src: "a cat", tgt: "kedi" },
    { src: "a dog", tgt: "köpek" },
  ];
  const m = buildModel(par, { iterations: 30 });
  assert.match(translate(m, "the cat"), /[Kk]edi/);
  assert.match(translate(m, "a dog"), /[Kk]öpek/);
});

test("translate: çıktı cilası özel ismi geri getirir (kelime motoru paritesi)", () => {
  // "London" kendine çevrilir (özel isim); çeviride küçük harfe düşer ama cümle
  // ortasında olduğu için detokenize büyütmez -> restoreCasing geri getirmeli.
  // polish:false ile büyük harf geri GELMEMELİ.
  const par = [
    { src: "the city is London", tgt: "şehir London" },
    { src: "the city is big", tgt: "şehir büyük" },
  ];
  const m = buildModel(par, { iterations: 30 });
  const polished = translate(m, "the city is London");
  assert.match(polished, /London/, "özel isim büyük harfle geri gelmeli");
  const raw = translate(m, "the city is London", { polish: false });
  assert.match(raw, /london/, "polish:false ile büyük harf geri gelmemeli");
});

test("decode: Kneser-Ney kelime motorunda devreye girer (yeterli veride)", () => {
  const adj = ["big", "small", "black", "white", "fast", "slow", "new", "old", "nice", "long", "short", "hot", "cold", "clean", "dirty", "blue", "green", "yellow"];
  const trAdj = ["büyük", "küçük", "siyah", "beyaz", "hızlı", "yavaş", "yeni", "eski", "güzel", "uzun", "kısa", "sıcak", "soğuk", "temiz", "kirli", "mavi", "yeşil", "sarı"];
  const noun = ["cat", "dog", "house", "car", "bird", "table", "door", "road"];
  const trNoun = ["kedi", "köpek", "ev", "araba", "kuş", "masa", "kapı", "yol"];
  const par = [];
  for (let i = 0; i < adj.length; i++) for (let j = 0; j < adj.length; j++) {
    if (i === j) continue;
    for (let n = 0; n < noun.length; n++) par.push({ src: `${adj[i]} ${adj[j]} ${noun[n]}`, tgt: `${trAdj[i]} ${trAdj[j]} ${trNoun[n]}` });
  }
  const m = buildModel(par, { iterations: 6 });
  assert.ok(m.lm.tri.size >= 2000, "yeterli trigram olmalı");
  // KN açık (varsayılan): çeviri doğru + KN süreklilik tabloları kurulmalı
  assert.match(translate(m, "big black cat"), /[Bb]üyük siyah kedi/);
  assert.ok(m.lm._kn, "KN süreklilik tabloları kurulmalı");
  // KN kapalı (interpolasyon) da çalışmalı
  assert.match(translate(m, "big black cat", { kn: false }), /[Bb]üyük siyah kedi/);
});

test("kelime motoru: serialize/deserialize round-trip", () => {
  const m = buildModel([{ src: "the cat", tgt: "kedi" }, { src: "the dog", tgt: "köpek" }], { iterations: 15 });
  const before = translate(m, "the cat");
  const after = translate(deserialize(serialize(m)), "the cat");
  assert.equal(before, after);
});
