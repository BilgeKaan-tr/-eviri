import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tokenize, detokenize, trLower, splitSentences,
  trainIBM1, trainLM, lmScore3, buildModel, translate, serialize, deserialize,
} from "../src/mt/engine.js";

test("trLower: Türkçe büyük I/İ", () => {
  assert.equal(trLower("İSTANBUL"), "istanbul");
  assert.equal(trLower("IŞIK"), "ışık");
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

test("kelime motoru: serialize/deserialize round-trip", () => {
  const m = buildModel([{ src: "the cat", tgt: "kedi" }, { src: "the dog", tgt: "köpek" }], { iterations: 15 });
  const before = translate(m, "the cat");
  const after = translate(deserialize(serialize(m)), "the cat");
  assert.equal(before, after);
});
