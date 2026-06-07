// ============================================================================
//  Otomatik cümle hizalama — Gale & Church (1993)
//  Ham iki metni (düz kaynak + düz Türkçe) cümle UZUNLUKLARINA göre hizalar.
//  Dilden bağımsızdır: "uzun cümle uzun cümleye denk gelir" sezgisine dayanır.
//  Dinamik programlama ile 1-1, 1-0, 0-1, 2-1, 1-2, 2-2 eşleşmelerini bulur.
// ============================================================================
import { splitSentences, tokenize, trainIBM1 } from "./engine.js";

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
// Genel DP: blockCost(i,ni,j,nj,type) ile herhangi bir maliyet fonksiyonunu hizalar
function alignDP(n, m, blockCost) {
  const D = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
  const back = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(null));
  D[0][0] = 0;
  const moves = [
    [1, 1, "1-1"], [1, 0, "1-0"], [0, 1, "0-1"],
    [2, 1, "2-1"], [1, 2, "1-2"], [2, 2, "2-2"],
  ];
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (D[i][j] === Infinity) continue;
      for (const [di, dj, type] of moves) {
        const ni = i + di, nj = j + dj;
        if (ni > n || nj > m) continue;
        const cost = D[i][j] + blockCost(i, ni, j, nj, type);
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

// Uzunluk-tabanlı (Gale-Church) hizalama: blok maliyeti = uzunluk + tür önseli
function alignByLength(srcSents, tgtSents) {
  const sl = srcSents.map((s) => s.length), tl = tgtSents.map((s) => s.length);
  const sum = (a, x, y) => { let s = 0; for (let k = x; k < y; k++) s += a[k]; return s; };
  return alignDP(srcSents.length, tgtSents.length,
    (i, ni, j, nj, type) => lengthCost(sum(sl, i, ni), sum(tl, j, nj)) + PRIOR[type]);
}

/**
 * İki geçişli (lexical-destekli) hizalama: önce uzunlukla kabaca hizala,
 * IBM-1 öğren, sonra UZUNLUK + KELİME ÖRTÜŞMESİ ile yeniden hizala. Gürültülü
 * kitap çiftlerinde (eksik/fazla cümle, serbest çeviri) Gale-Church'ten daha sağlam.
 * @returns {{src:string,tgt:string}[]}
 */
export function alignTextsRefine(srcText, tgtText, opts = {}) {
  const srcSents = splitSentences(srcText), tgtSents = splitSentences(tgtText);
  const n = srcSents.length, m = tgtSents.length;
  if (!n || !m) return [];
  const sl = srcSents.map((s) => s.length), tl = tgtSents.map((s) => s.length);
  const sum = (a, x, y) => { let s = 0; for (let k = x; k < y; k++) s += a[k]; return s; };
  const lenCost = (i, ni, j, nj, type) => lengthCost(sum(sl, i, ni), sum(tl, j, nj)) + PRIOR[type];

  // 1. geçiş: uzunluk
  const b1 = alignDP(n, m, lenCost);
  // IBM-1 öğren (1. geçiş çiftlerinden)
  const pairs = [];
  for (const b of b1) {
    if (b.sj > b.si && b.tj > b.ti) {
      pairs.push({ e: tokenize(srcSents.slice(b.si, b.sj).join(" "), "en"), f: tokenize(tgtSents.slice(b.ti, b.tj).join(" "), "tr") });
    }
  }
  const t = trainIBM1(pairs, opts.iterations || 5);

  // 2. geçiş: uzunluk + lexical
  const srcTok = srcSents.map((s) => tokenize(s, "en")), tgtTok = tgtSents.map((s) => tokenize(s, "tr"));
  const lambda = opts.lambda != null ? opts.lambda : 1.0;
  const lexCost = (i, ni, j, nj) => {
    const f = []; for (let k = j; k < nj; k++) f.push(...tgtTok[k]);
    if (!f.length) return 0;
    const e = []; for (let k = i; k < ni; k++) e.push(...srcTok[k]);
    let s = 0;
    for (const fw of f) { let best = 1e-4; for (const ew of e) { const p = t.get(ew)?.get(fw) || 0; if (p > best) best = p; } s += -Math.log(best); }
    return s / f.length;
  };
  const b2 = alignDP(n, m, (i, ni, j, nj, type) => lenCost(i, ni, j, nj, type) + lambda * lexCost(i, ni, j, nj));

  const out = [];
  for (const { si, sj, ti, tj } of b2) {
    if (sj - si === 0 || tj - ti === 0) continue;
    out.push({ src: srcSents.slice(si, sj).join(" "), tgt: tgtSents.slice(ti, tj).join(" ") });
  }
  return out;
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
