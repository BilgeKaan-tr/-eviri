// Trie tabanlı öbek tablosunun bellek (önek paylaşımı) ve arama (erken durma)
// kazancını gösterir. Çok sayıda ORTAK ÖNEKLİ öbek üretip ölçeriz.
import { buildPhraseModel } from "../src/mt/phrase.js";
import { buildPhraseTrie, trieNodeCount } from "../src/mt/trie.js";
import { tokenize } from "../src/mt/engine.js";

// Ortak önekli sentetik korpus: "the big red ...", "the big blue ..." gibi
const adjs = ["big", "small", "red", "blue", "green", "old", "new", "fast"];
const nouns = ["car", "house", "book", "dog", "cat", "tree", "road", "bird"];
const trAdj = { big: "büyük", small: "küçük", red: "kırmızı", blue: "mavi", green: "yeşil", old: "eski", new: "yeni", fast: "hızlı" };
const trNoun = { car: "araba", house: "ev", book: "kitap", dog: "köpek", cat: "kedi", tree: "ağaç", road: "yol", bird: "kuş" };
const parallel = [];
for (const a of adjs) for (const n of nouns) {
  parallel.push({ src: `the ${a} ${n}`, tgt: `${trAdj[a]} ${trNoun[n]}` });
}

const model = buildPhraseModel(parallel, { iterations: 25, maxPhrase: 4 });
const ptable = model.ptable;

// --- Bellek: trie düğümleri vs öbek anahtarlarındaki toplam token ---
let totalSrcTokens = 0;
for (const src of ptable.keys()) totalSrcTokens += src.split(" ").length;
const trie = buildPhraseTrie(ptable);
const nodes = trieNodeCount(trie);
console.log("== Bellek (kaynak tarafı) ==");
console.log(`  öbek sayısı            : ${ptable.size}`);
console.log(`  düz token toplamı      : ${totalSrcTokens}`);
console.log(`  trie düğüm sayısı      : ${nodes}  (ortak önekler paylaşıldı)`);
console.log(`  paylaşım kazancı       : %${Math.round((1 - nodes / totalSrcTokens) * 100)}`);

// --- Arama: naif (her uzunluk için lookup) vs trie (önek yoksa erken dur) ---
const sentences = ["the big red car", "the old green tree", "the fast blue bird is here"];
let naive = 0, trieSteps = 0;
const maxPhrase = 4;
for (const s of sentences) {
  const toks = tokenize(s, "en");
  for (let i = 0; i < toks.length; i++) {
    // naif: i'den itibaren maxPhrase'e kadar her uzunlukta arama dener
    naive += Math.min(maxPhrase, toks.length - i);
    // trie: önek bitene kadar yürür
    let node = trie;
    for (let len = 1; len <= maxPhrase && i + len <= toks.length; len++) {
      node = node.ch.get(toks[i + len - 1]);
      trieSteps++;
      if (!node) break; // erken durma
    }
  }
}
console.log("\n== Arama adımları (3 cümle) ==");
console.log(`  naif lookup denemesi   : ${naive}`);
console.log(`  trie adımı (erken dur) : ${trieSteps}`);
console.log(`  daha az iş             : %${Math.round((1 - trieSteps / naive) * 100)}`);
