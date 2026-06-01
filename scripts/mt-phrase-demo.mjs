// Öbek-tabanlı motorun, kelime-tabanlı motorun başaramadığı çok-kelimeli
// ifadeleri (idiyom/kalıp) doğru çevirdiğini gösterir.
import { buildModel, translate as translateWord } from "../src/mt/engine.js";
import { buildPhraseModel, translatePhrase } from "../src/mt/phrase.js";

// İngilizce kalıpların Türkçe karşılığı kelime kelime tutmaz:
//  "thank you" -> "teşekkür ederim" (2->2 ama kelime eşi yok)
//  "good morning" -> "günaydın" (2->1)
const parallel = [
  { src: "thank you", tgt: "teşekkür ederim" },
  { src: "thank you very much", tgt: "çok teşekkür ederim" },
  { src: "thank you my friend", tgt: "teşekkür ederim dostum" },
  { src: "good morning", tgt: "günaydın" },
  { src: "good morning my friend", tgt: "günaydın dostum" },
  { src: "good night", tgt: "iyi geceler" },
  { src: "the red car", tgt: "kırmızı araba" },
  { src: "the blue car", tgt: "mavi araba" },
  { src: "the red car is fast", tgt: "kırmızı araba hızlı" },
  { src: "the blue car is fast", tgt: "mavi araba hızlı" },
  { src: "good night my friend", tgt: "iyi geceler dostum" },
  { src: "thank you very much my friend", tgt: "çok teşekkür ederim dostum" },
];

const wordModel = buildModel(parallel, { iterations: 30 });
const phraseModel = buildPhraseModel(parallel, { iterations: 30, maxPhrase: 4 });

const tests = ["thank you", "good morning", "good night", "the red car is fast", "thank you very much"];

console.log("girdi".padEnd(26), "| kelime-tabanlı".padEnd(26), "| öbek-tabanlı");
console.log("-".repeat(80));
for (const s of tests) {
  const w = translateWord(wordModel, s);
  const p = translatePhrase(phraseModel, s);
  console.log(`"${s}"`.padEnd(26), "| " + w.padEnd(24), "| " + p);
}

console.log("\nÖğrenilen bazı öbekler:");
for (const ph of ["thank you", "good morning", "good night"]) {
  const m = phraseModel.ptable.get(ph);
  if (m) console.log(`  "${ph}" -> "${[...m.entries()].sort((a,b)=>b[1]-a[1])[0][0]}"`);
}
