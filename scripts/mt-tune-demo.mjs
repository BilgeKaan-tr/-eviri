// Ağırlık ayarının BLEU'yu nasıl artırdığını gösterir.
// maxPhrase=2 ile SVO->SOV reordering gerekir; varsayılan distortionWeight
// fazla yüksek olduğundan yüklem yanlış yere gelir. Ayarlayıcı düşürünce düzelir.
import { buildPhraseModel, translatePhrase } from "../src/mt/phrase.js";
import { tuneWeights, evaluate } from "../src/mt/tune.js";

const train = [
  { src: "i read the book", tgt: "ben kitabı okudum" },
  { src: "you read the book", tgt: "sen kitabı okudun" },
  { src: "i read the newspaper", tgt: "ben gazeteyi okudum" },
  { src: "you read the newspaper", tgt: "sen gazeteyi okudun" },
  { src: "i ate the apple", tgt: "ben elmayı yedim" },
  { src: "you ate the apple", tgt: "sen elmayı yedin" },
  { src: "i ate the bread", tgt: "ben ekmeği yedim" },
  { src: "you read the apple", tgt: "sen elmayı okudun" },
];
const dev = [
  { src: "you ate the bread", tgt: "sen ekmeği yedin" },
  { src: "i read the newspaper", tgt: "ben gazeteyi okudum" },
];

const model = buildPhraseModel(train, { iterations: 40, maxPhrase: 2 });

const def = { lmWeight: 0.7, wordBonus: 2.5, distortionWeight: 0.25 };
const bleuDef = evaluate(model, dev, def);

const { weights, bleu } = tuneWeights(model, dev);

console.log("Örnek (dev) çeviriler:");
for (const d of dev) {
  const a = translatePhrase(model, d.src, def);
  model.weights = weights;
  const b = translatePhrase(model, d.src);
  model.weights = null;
  console.log(`  "${d.src}"`);
  console.log(`     referans : ${d.tgt}`);
  console.log(`     varsayılan: ${a}`);
  console.log(`     ayarlı    : ${b}`);
}
console.log(`\nBLEU: ${(bleuDef * 100).toFixed(1)} (varsayılan) -> ${(bleu * 100).toFixed(1)} (ayarlı)`);
console.log("En iyi ağırlıklar:", weights);
