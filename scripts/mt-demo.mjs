// İstatistiksel ceviri motorunu kucuk bir paralel metinle egitip dener.
// Amac: motorun, ezber degil, kelime hizalamasini OGRENDIGINI gostermek.
import { buildModel, translate } from "../src/mt/engine.js";

// Ortak kelime daginimi olan kucuk bir paralel kulliyat (en <-> tr)
const parallel = [
  { src: "the cat is black", tgt: "kedi siyah" },
  { src: "the dog is black", tgt: "köpek siyah" },
  { src: "the cat is small", tgt: "kedi küçük" },
  { src: "the dog is big", tgt: "köpek büyük" },
  { src: "the house is big", tgt: "ev büyük" },
  { src: "the house is small", tgt: "ev küçük" },
  { src: "the cat is white", tgt: "kedi beyaz" },
  { src: "the dog is white", tgt: "köpek beyaz" },
  { src: "the small cat", tgt: "küçük kedi" },
  { src: "the big dog", tgt: "büyük köpek" },
  { src: "the white house is big", tgt: "beyaz ev büyük" },
  { src: "the black cat is small", tgt: "siyah kedi küçük" },
];

const model = buildModel(parallel, { srcLang: "en", iterations: 30 });

// Ogrenilen kelime karsiliklari (en -> en olasi turkce)
console.log("== Öğrenilen kelime karşılıkları ==");
for (const w of ["cat", "dog", "house", "black", "white", "big", "small"]) {
  const m = model.t.get(w);
  if (!m) { console.log(`  ${w} -> (öğrenilmedi)`); continue; }
  const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  console.log(`  ${w.padEnd(7)} -> ${best[0].padEnd(8)} (%${Math.round(best[1] * 100)})`);
}

// Egitimde TAM olarak bulunmayan cumleler
console.log("\n== Çeviri denemeleri (eğitimde bu cümleler yok) ==");
for (const s of [
  "the white cat is big",
  "the black dog is small",
  "the house is white",
]) {
  console.log(`  "${s}"  ->  "${translate(model, s)}"`);
}
