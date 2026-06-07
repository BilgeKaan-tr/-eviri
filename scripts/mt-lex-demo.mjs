// Lexical weighting'in değerini gösterir.
// "the book" için iki aday EŞİT φ (%50) alıyor ama lex'leri farklı:
//   kitap   -> lex 0.90 (kelimeler birbirine çevriliyor: doğru)
//   büyük ev-> lex 0.001 (kelime karşılığı yok: sahte/gürültü)
// Dil modeli (yanlışlıkla) "büyük ev"i daha akıcı buluyor. lexWeight=0 iken
// yanlış seçilir; lexWeight artınca lex doğruyu ("kitap") seçtirir.
import { trainLM } from "../src/mt/engine.js";
import { translatePhrase } from "../src/mt/phrase.js";

const ptable = new Map([
  ["the book", new Map([["kitap", [0.5, 0.90]], ["büyük ev", [0.5, 0.001]]])],
]);
// "büyük ev" dil modelinde daha sık -> LM onu kayırır
const lm = trainLM([
  ["büyük", "ev"], ["büyük", "ev"], ["güzel", "büyük", "ev"], ["kitap"],
]);
const model = { ptable, lm, srcLang: "en", maxPhrase: 2 };

console.log('girdi: "the book"  (doğru: kitap)\n');
for (const lw of [0, 0.5, 1.5]) {
  const out = translatePhrase(model, "the book", { lexWeight: lw, reorder: false });
  console.log(`  lexWeight=${lw.toString().padEnd(4)} -> ${out}`);
}
console.log("\nlexWeight arttıkça, kelime düzeyinde tutarlı (lex'i yüksek) öbek seçilir.");
