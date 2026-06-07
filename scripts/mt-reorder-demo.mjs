// Yeniden sıralama (reordering) çözücüsünün, öbekler arası sırayı
// değiştirebildiğini gösterir (İngilizce SVO -> Türkçe SOV: yüklem sona).
//
// NOT: Küçük veride kelime HİZALAMASI güvenilmezdir; bu yüzden burada
// çözücüyü hizalama gürültüsünden ayırmak için TEMİZ bir öbek tablosu elle
// kuruyoruz. Böylece yalnızca çözücünün sıralama yeteneği ölçülür.
import { trainLM } from "../src/mt/engine.js";
import { translatePhrase } from "../src/mt/phrase.js";

const ptable = new Map([
  ["i", new Map([["ben", 1]])],
  ["read", new Map([["okudum", 1]])],
  ["book", new Map([["kitabı", 1]])],
  ["the", new Map([["", 1]])], // artikel: düşür
]);
// Türkçe dil modeli doğru sırayı (SOV) bilsin
const lm = trainLM([
  ["ben", "kitabı", "okudum"],
  ["ben", "gazeteyi", "okudum"],
  ["sen", "kitabı", "okudun"],
]);
const model = { ptable, lm, srcLang: "en", maxPhrase: 2 };

const s = "i read the book";
console.log(`girdi: "${s}"  (hedef: "ben kitabı okudum")\n`);
console.log("monoton            :", translatePhrase(model, s, { reorder: false, wordBonus: 2.5 }));
console.log("yeniden-sıralamalı :", translatePhrase(model, s, { reorder: true, distortionLimit: 6, distortionWeight: 0.1, wordBonus: 2.5 }));
