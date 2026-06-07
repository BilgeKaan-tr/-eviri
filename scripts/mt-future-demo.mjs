// Future cost'un ARAMA kalitesini nasıl artırdığını gösterir (küçük beam).
// Future cost, eşit-kapsamlı hipotezleri adil karşılaştırır; küçük beam'de
// yanlış erken budamayı azaltır. Met: bulunan en iyi hipotez skoru (yüksek=iyi).
// Garanti: future cost skoru ASLA düşürmez (ON >= OFF).
import { buildPhraseModel, decodePhraseReorder } from "../src/mt/phrase.js";
import { tokenize } from "../src/mt/engine.js";

// Çeşitli uzunluk/yapıda korpus (arama uzayını zenginleştirir)
const par = [
  { src: "the cat sat on the mat", tgt: "kedi paspasın üstüne oturdu" },
  { src: "the dog ran in the park", tgt: "köpek parkta koştu" },
  { src: "a big red car stopped here", tgt: "büyük kırmızı bir araba burada durdu" },
  { src: "she read the old book slowly", tgt: "o eski kitabı yavaşça okudu" },
  { src: "we walked to the river yesterday", tgt: "dün nehre yürüdük" },
  { src: "the man gave the boy a ball", tgt: "adam çocuğa bir top verdi" },
  { src: "birds fly over the tall trees", tgt: "kuşlar uzun ağaçların üstünden uçar" },
  { src: "i bought fresh bread this morning", tgt: "bu sabah taze ekmek aldım" },
  { src: "the red car is very fast", tgt: "kırmızı araba çok hızlı" },
  { src: "he put the book on the table", tgt: "kitabı masanın üstüne koydu" },
];
const model = buildPhraseModel(par, { iterations: 25, maxPhrase: 3, stem: true });

const sents = [
  "the cat ran in the park", "she read a big book slowly",
  "the man gave the dog a ball", "i bought the red book this morning",
  "he put the cat on the table", "we walked to the tall river yesterday",
];
const beam = 2; // çok küçük beam: budama hatalarına açık
let sumOn = 0, sumOff = 0, better = 0, worse = 0;
for (const s of sents) {
  const e = tokenize(s, "en");
  const off = decodePhraseReorder(e, model, { beam, returnScore: true, futureCost: false, distortionLimit: 6 });
  const on = decodePhraseReorder(e, model, { beam, returnScore: true, futureCost: true, distortionLimit: 6 });
  sumOff += off.score; sumOn += on.score;
  if (on.score > off.score + 1e-9) better++;
  if (on.score < off.score - 1e-9) worse++;
  const mark = on.score > off.score + 1e-9 ? "↑ daha iyi" : (on.score < off.score - 1e-9 ? "↓" : "=");
  console.log(`"${s}"  OFF ${off.score.toFixed(1)} | ON ${on.score.toFixed(1)}  ${mark}`);
}
console.log(`\nOrtalama skor: OFF ${(sumOff / sents.length).toFixed(2)} -> ON ${(sumOn / sents.length).toFixed(2)}`);
console.log(`daha iyi: ${better}/${sents.length} · daha kötü: ${worse}/${sents.length} (future cost skoru asla düşürmez)`);
