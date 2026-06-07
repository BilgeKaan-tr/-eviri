// ============================================================================
//  Otomatik cümle hizalama — Gale & Church (1993)
//  Ham iki metni (düz kaynak + düz Türkçe) cümle UZUNLUKLARINA göre hizalar.
//  Dilden bağımsızdır: "uzun cümle uzun cümleye denk gelir" sezgisine dayanır.
//  Dinamik programlama ile 1-1, 1-0, 0-1, 2-1, 1-2, 2-2 eşleşmelerini bulur.
// ============================================================================
import { splitSentences } from "./engine.js";

const C = 1.0;    // E(hedef/kaynak uzunluk oranı) — benzer diller için ~1
const S2 = 6.8;   // varyans (Gale-Church standart sabiti)

// Normal dağılım CDF (erf yaklaşımı, Abramowitz-Stegun 7.1.26)
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
const pnorm = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

// Uzunluk farkına dayalı maliyet (küçük = iyi eşleşme)
function lengthCost(l1, l2) {
  if (l1 === 0 && l2 === 0) return 0;
  const lc1 = Math.max(l1, 1);
  const delta = (l2 - l1 * C) / Math.sqrt(lc1 * S2);
  let prob = 2 * (1 - pnorm(Math.abs(delta)));
  if (prob < 1e-10) prob = 1e-10;
  return -Math.log(prob);
}
// Eşleşme türü önsel cezaları (-log prior)
const PRIOR = {
  "1-1": -Math.log(0.89),
  "1-0": -Math.log(0.0099),
  "0-1": -Math.log(0.0099),
  "2-1": -Math.log(0.089),
  "1-2": -Math.log(0.089),
  "2-2": -Math.log(0.011),
};

/**
 * @param {string[]} srcSents kaynak cümleler
 * @param {string[]} tgtSents hedef (Türkçe) cümleler
 * @returns {{si:number,sj:number,ti:number,tj:number}[]} hizalama blokları (indeks aralıkları)
 */
function alignByLength(srcSents, tgtSents) {
  const n = srcSents.length, m = tgtSents.length;
  const sl = srcSents.map((s) => s.length);
  const tl = tgtSents.map((s) => s.length);
  const sum = (arr, a, b) => { let s = 0; for (let k = a; k < b; k++) s += arr[k]; return s; };

  // D[i][j] = ilk i kaynak + ilk j hedef cümleyi hizalama maliyeti
  const D = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
  const back = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(null));
  D[0][0] = 0;

  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (D[i][j] === Infinity) continue;
      const moves = [
        [1, 1, "1-1"], [1, 0, "1-0"], [0, 1, "0-1"],
        [2, 1, "2-1"], [1, 2, "1-2"], [2, 2, "2-2"],
      ];
      for (const [di, dj, type] of moves) {
        const ni = i + di, nj = j + dj;
        if (ni > n || nj > m) continue;
        const l1 = sum(sl, i, ni);
        const l2 = sum(tl, j, nj);
        const cost = D[i][j] + lengthCost(l1, l2) + PRIOR[type];
        if (cost < D[ni][nj]) { D[ni][nj] = cost; back[ni][nj] = [i, j, type]; }
      }
    }
  }

  // Geri izleme
  const blocks = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const b = back[i][j];
    if (!b) break;
    const [pi, pj] = b;
    blocks.push({ si: pi, sj: i, ti: pj, tj: j });
    i = pi; j = pj;
  }
  blocks.reverse();
  return blocks;
}

/**
 * İki ham metni hizalayıp eğitim için cümle çiftleri döndürür.
 * Sadece her iki tarafta da içerik olan bloklar (1-1, 2-1, 1-2, 2-2) tutulur;
 * ekleme/silme (1-0, 0-1) atlanır.
 * @returns {{src:string,tgt:string}[]}
 */
export function alignTexts(srcText, tgtText) {
  const srcSents = splitSentences(srcText);
  const tgtSents = splitSentences(tgtText);
  const blocks = alignByLength(srcSents, tgtSents);
  const pairs = [];
  for (const { si, sj, ti, tj } of blocks) {
    if (sj - si === 0 || tj - ti === 0) continue; // ekleme/silme
    pairs.push({
      src: srcSents.slice(si, sj).join(" "),
      tgt: tgtSents.slice(ti, tj).join(" "),
    });
  }
  return pairs;
}

export { alignByLength };
