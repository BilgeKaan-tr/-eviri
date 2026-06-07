// Bilinmeyen kelime yedeği: eğitimde görülmeyen çekimli biçimler (çoğul vb.)
// İngilizce kök türevlerine indirgenip tabloda aranır.
import { buildPhraseModel, translatePhrase } from "../src/mt/phrase.js";

const nouns = { car: "araba", book: "kitap", city: "şehir", pen: "kalem" };
const adjs = { big: "büyük", small: "küçük", new: "yeni", old: "eski" };
const par = [];
for (const [n, tn] of Object.entries(nouns)) {
  for (let k = 0; k < 3; k++) par.push({ src: n, tgt: tn });
  for (const [a, ta] of Object.entries(adjs)) par.push({ src: `${a} ${n}`, tgt: `${ta} ${tn}` });
}
const model = buildPhraseModel(par, { iterations: 25, maxPhrase: 2 });

console.log("Eğitimde OLMAYAN çekimli biçimler (lemma yedeğiyle çevrilir):");
for (const s of ["books", "cars", "cities", "pens", "big books", "old cars"]) {
  console.log(`  "${s}" -> "${translatePhrase(model, s, { reorder: false })}"`);
}
console.log("\n(cities -> ies→y kökü 'city'; books -> 's' düşürülüp 'book')");
