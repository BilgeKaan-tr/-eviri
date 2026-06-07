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
    if (!node) { if (len === 1) res.push({ len: 1, options: UNK(eTokens[i]) }); break; }
    if (node.tr) {
      res.push({ len, options: [...node.tr.entries()].sort((a, b) => cOf(b[1]) - cOf(a[1])).slice(0, topK) });
    } else if (len === 1) {
      res.push({ len: 1, options: UNK(eTokens[i]) });
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
