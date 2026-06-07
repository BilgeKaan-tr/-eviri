// Türkçe stemmer'ı ve stem-tabanlı hizalamanın veri kıtlığını nasıl
// azalttığını (IBM-1 olasılıklarında) gösterir.
import { stemTr, stemTokens } from "../src/mt/morph.js";
import { tokenize, trainIBM1 } from "../src/mt/engine.js";

console.log("== Stemmer: çekimli biçimler ortak köke iniyor ==");
for (const w of ["kitap", "kitabı", "kitaba", "kitapta", "kitaplar", "kitaplardan", "evden", "evler"]) {
  console.log(`  ${w.padEnd(12)} -> ${stemTr(w)}`);
}

// "book" her cümlede FARKLI çekimle geçen Türkçe karşılığa bağlanıyor.
const parallel = [
  { src: "i read the book", tgt: "kitabı okudum" },
  { src: "i go to the book", tgt: "kitaba gittim" },
  { src: "it is in the book", tgt: "kitapta buldum" },
  { src: "the book is big", tgt: "kitap büyük" },
  { src: "i like the book", tgt: "kitabı sevdim" },
];
const pairs = parallel.map(({ src, tgt }) => ({ e: tokenize(src, "en"), f: tokenize(tgt, "tr") }));

const tNo = trainIBM1(pairs, 40);
const tYes = trainIBM1(pairs.map(({ e, f }) => ({ e, f: stemTokens(f) })), 40);

const top = (t, w, k = 3) => {
  const m = t.get(w);
  if (!m) return "(yok)";
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k)
    .map(([x, p]) => `${x}:%${Math.round(p * 100)}`).join("  ");
};

console.log("\n== 'book' için öğrenilen hedef olasılık dağılımı ==");
console.log("  stemsiz :", top(tNo, "book"));
console.log("  stemli  :", top(tYes, "book"));
console.log("\nStemsizde olasılık çekimli biçimlere DAĞILIR; stemlide tek köke");
console.log("('kitap') TOPLANIR -> çok daha güçlü, güvenilir hizalama.");
