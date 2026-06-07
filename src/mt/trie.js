// ============================================================================
//  Trie (önek ağacı) tabanlı öbek tablosu — büyük modellerde bellek/hız.
//  Kaynak öbekler token-token bir ağaçta saklanır:
//   - ortak önekler paylaşılır (bellek),
//   - çözücü bir konumdan ağaçta yürür; önek yoksa ERKEN durur ve string
//     birleştirme (join) yapmaz (hız).
//  Yaprak/uç düğümlerde .tr = Map(hedefÖbek -> [φ, lex]).
// ============================================================================
const cOf = (v) => (Array.isArray(v) ? v[0] : v);
const UNK = (tok) => [[tok, [0.1, 1]], ["", [1e-3, 1]]]; // bilinmeyen: geçir / düşür

// İngilizce hafif lemma türevleri (çekim eki soyma) — bilinmeyen kelime yedeği
function enLemmas(tok) {
  const w = tok.toLowerCase();
  const out = new Set();
  if (w.length > 3 && w.endsWith("ies")) out.add(w.slice(0, -3) + "y"); // cities->city
  if (w.length > 3 && w.endsWith("es")) out.add(w.slice(0, -2));        // boxes->box
  if (w.length > 2 && w.endsWith("s")) out.add(w.slice(0, -1));         // cars->car
  if (w.length > 4 && w.endsWith("ing")) { out.add(w.slice(0, -3)); out.add(w.slice(0, -3) + "e"); } // making->make
  if (w.length > 3 && w.endsWith("ed")) { out.add(w.slice(0, -2)); out.add(w.slice(0, -1)); }        // used->use
  out.delete(w);
  return [...out].filter((v) => v.length >= 2);
}
// Bilinmeyen tek kelime için: lemma türevlerini tabloda ara (φ'ye küçük ceza)
function lemmaOptions(root, tok, topK) {
  for (const v of enLemmas(tok)) {
    const node = root.ch.get(v);
    if (node && node.tr) {
      return [...node.tr.entries()]
        .sort((a, b) => cOf(b[1]) - cOf(a[1])).slice(0, topK)
        .map(([t, pv]) => [t, [cOf(pv) * 0.5, Array.isArray(pv) ? pv[1] : 1]]); // belirsizlik cezası
    }
  }
  return null;
}

export function buildPhraseTrie(ptable) {
  const root = { ch: new Map() };
  for (const [src, cands] of ptable) {
    let node = root;
    for (const tk of src.split(" ")) {
      let nx = node.ch.get(tk);
      if (!nx) node.ch.set(tk, (nx = { ch: new Map() }));
      node = nx;
    }
    node.tr = cands;
  }
  return root;
}

// i. konumdan başlayarak geçerli (uzunluk, adaylar) çiftlerini döndürür.
// Aday listesi φ'ye göre sıralı ve topK ile kırpılmıştır; len===1 için
// bilinmeyen-kelime seçenekleri de eklenir (Map sürümüyle aynı davranış).
export function phraseOptionsAt(root, eTokens, i, n, maxPhrase, topK) {
  const res = [];
  let node = root;
  for (let len = 1; len <= maxPhrase && i + len <= n; len++) {
    node = node.ch.get(eTokens[i + len - 1]);
    if (!node) { if (len === 1) res.push({ len: 1, options: lemmaOptions(root, eTokens[i], topK) || UNK(eTokens[i]) }); break; }
    if (node.tr) {
      res.push({ len, options: [...node.tr.entries()].sort((a, b) => cOf(b[1]) - cOf(a[1])).slice(0, topK) });
    } else if (len === 1) {
      res.push({ len: 1, options: lemmaOptions(root, eTokens[i], topK) || UNK(eTokens[i]) });
    }
  }
  return res;
}

// İstatistik (bellek gösterimi için): düğüm sayısı.
export function trieNodeCount(root) {
  let count = 0;
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    count++;
    for (const child of node.ch.values()) stack.push(child);
  }
  return count;
}
