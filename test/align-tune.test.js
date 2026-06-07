import { test } from "node:test";
import assert from "node:assert/strict";
import { alignTexts, alignTextsRefine } from "../src/mt/align.js";
import { buildPhraseModel } from "../src/mt/phrase.js";
import { corpusBleu, evaluate, tuneWeights } from "../src/mt/tune.js";
import { tokenize } from "../src/mt/engine.js";

const en = "The sun rose over the hills. It was a beautiful morning and the birds were singing loudly everywhere. The old man walked slowly to the market.";
const tr = "Güneş tepelerin üzerinde doğdu. Güzel bir sabahtı. Kuşlar her yerde yüksek sesle ötüyordu. Yaşlı adam yavaşça pazara yürüdü.";

test("alignTexts: 4 EN / 4 TR cümlede 1-2 bölünmeyi yakalar", () => {
  const pairs = alignTexts(en, tr);
  assert.ok(pairs.length >= 2 && pairs.length <= 4);
  // ilk çift birebir eşleşmeli
  assert.match(pairs[0].src, /sun rose/);
  assert.match(pairs[0].tgt, /Güneş/);
});

test("alignTextsRefine: çalışır ve geçerli çiftler üretir", () => {
  const pairs = alignTextsRefine(en, tr, { iterations: 3 });
  assert.ok(pairs.length >= 2);
  for (const p of pairs) { assert.ok(p.src.length && p.tgt.length); }
});

test("corpusBleu: aynı metinde ~1.0", () => {
  const c = [tokenize("kedi siyah", "tr")];
  const r = [tokenize("kedi siyah", "tr")];
  assert.ok(corpusBleu(c, r) > 0.9);
});

test("tuneWeights: BLEU'yu düşürmez (ON >= başlangıç)", () => {
  const par = [
    { src: "the red car", tgt: "kırmızı araba" },
    { src: "the blue car", tgt: "mavi araba" },
    { src: "the red book", tgt: "kırmızı kitap" },
  ];
  const m = buildPhraseModel(par, { iterations: 20, maxPhrase: 2 });
  const dev = [{ src: "the blue car", tgt: "mavi araba" }];
  const { bleu, startBleu } = tuneWeights(m, dev);
  assert.ok(bleu >= startBleu - 1e-9);
});

test("evaluate: ayarlı ağırlıklarla skor üretir", () => {
  const m = buildPhraseModel([{ src: "good morning", tgt: "günaydın" }], { iterations: 15 });
  const s = evaluate(m, [{ src: "good morning", tgt: "günaydın" }], {});
  assert.ok(s >= 0 && s <= 1);
});
