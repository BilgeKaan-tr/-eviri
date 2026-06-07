// ============================================================================
//  Öbek-tabanlı istatistiksel çeviri (Phrase-based SMT)
//  Kelime kelime yerine "kelime gruplarını" öğrenir -> çok daha doğal çeviri.
//
//  Boru hattı (Koehn'in klasik yöntemi):
//    1) İki yönlü kelime hizalaması (IBM Model 1: e->f ve f->e)
//    2) Hizalamaları birleştir (grow-diag-final-and)
//    3) Tutarlı öbek çiftlerini çıkar
//    4) Öbek olasılıklarını skorla  φ(f̄ | ē)
//    5) Öbek-tabanlı monoton beam çözücü (+ Türkçe dil modeli)
// ============================================================================
import {
  tokenize,
  splitSentences,
  trainIBM1,
  trainLM,
  lmScore,
  lmScore3,
  detokenize,
} from "./engine.js";

// ---- 1) Tek yönlü IBM-1 hizalaması ----
// t: Map(e -> Map(f -> p)).  Her f kelimesini en olası e'ye baglar -> (i,j).
function alignEF(e, f, t) {
  const pts = new Set();
  for (let j = 0; j < f.length; j++) {
    let bi = -1, best = 0;
    for (let i = 0; i < e.length; i++) {
      const p = t.get(e[i])?.get(f[j]) || 0;
      if (p > best) { best = p; bi = i; }
    }
    if (bi >= 0) pts.add(bi + "," + j);
  }
  return pts;
}
// t2: Map(f -> Map(e -> p)).  Her e kelimesini en olası f'ye baglar -> (i,j).
function alignFE(e, f, t2) {
  const pts = new Set();
  for (let i = 0; i < e.length; i++) {
    let bj = -1, best = 0;
    for (let j = 0; j < f.length; j++) {
      const p = t2.get(f[j])?.get(e[i]) || 0;
      if (p > best) { best = p; bj = j; }
    }
    if (bj >= 0) pts.add(i + "," + bj);
  }
  return pts;
}

// ---- 2) Hizalamaları birleştir: grow-diag-final-and ----
function symmetrize(a1, a2, n, m) {
  const key = (i, j) => i + "," + j;
  const inter = new Set([...a1].filter((p) => a2.has(p)));
  const union = new Set([...a1, ...a2]);
  const A = new Set(inter);
  const srcCov = new Set(), tgtCov = new Set();
  for (const p of A) { const [i, j] = p.split(",").map(Number); srcCov.add(i); tgtCov.add(j); }
  const neigh = [[-1,0],[0,-1],[1,0],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];

  let added = true;
  while (added) {
    added = false;
    for (const p of [...A]) {
      const [i, j] = p.split(",").map(Number);
      for (const [di, dj] of neigh) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= n || nj >= m) continue;
        const nk = key(ni, nj);
        if (union.has(nk) && !A.has(nk) && (!srcCov.has(ni) || !tgtCov.has(nj))) {
          A.add(nk); srcCov.add(ni); tgtCov.add(nj); added = true;
        }
      }
    }
  }
  // final-and: union'daki, iki ucu da bagsiz noktalari ekle
  for (const nk of union) {
    const [i, j] = nk.split(",").map(Number);
    if (!A.has(nk) && !srcCov.has(i) && !tgtCov.has(j)) {
      A.add(nk); srcCov.add(i); tgtCov.add(j);
    }
  }
  return A;
}

// ---- 3) Tutarlı öbek çiftlerini çıkar ----
function extractPhrases(e, f, A, maxLen, counts, srcCounts) {
  const n = e.length, m = f.length;
  const pts = [...A].map((p) => p.split(",").map(Number));
  for (let i1 = 0; i1 < n; i1++) {
    for (let i2 = i1; i2 < Math.min(n, i1 + maxLen); i2++) {
      let jmin = Infinity, jmax = -1;
      for (const [i, j] of pts) if (i >= i1 && i <= i2) { if (j < jmin) jmin = j; if (j > jmax) jmax = j; }
      if (jmax < 0) continue;                 // hizalama yok
      if (jmax - jmin >= maxLen) continue;     // hedef öbek çok uzun
      // tutarlilik: [jmin,jmax] icine baglanan her kaynak kelime [i1,i2] icinde olmali
      let ok = true;
      for (const [i, j] of pts) if (j >= jmin && j <= jmax && (i < i1 || i > i2)) { ok = false; break; }
      if (!ok) continue;
      const src = e.slice(i1, i2 + 1).join(" ");
      const tgt = f.slice(jmin, jmax + 1).join(" ");
      let mm = counts.get(src);
      if (!mm) counts.set(src, (mm = new Map()));
      mm.set(tgt, (mm.get(tgt) || 0) + 1);
      srcCounts.set(src, (srcCounts.get(src) || 0) + 1);
    }
  }
}

// ============================================================================
//  Yüksek seviye: model kur / çevir
// ============================================================================
export function buildPhraseModel(parallel, opts = {}) {
  const srcLang = opts.srcLang || "en";
  const iterations = opts.iterations || 12;
  const maxLen = opts.maxPhrase || 4;
  const minCount = opts.minCount || 1;   // büyük veride 2-3 yapın
  const maxCand = opts.maxCand || 20;    // kaynak öbek başına aday sayısı

  // Tokenize
  const pairs = [], tgtTok = [];
  for (const { src, tgt } of parallel) {
    const e = tokenize(src, srcLang), f = tokenize(tgt, "tr");
    if (e.length && f.length) { pairs.push({ e, f }); tgtTok.push(f); }
  }

  // İki yönlü IBM-1
  const t = trainIBM1(pairs, iterations);
  const t2 = trainIBM1(pairs.map(({ e, f }) => ({ e: f, f: e })), iterations);

  // Hizala + öbek çıkar
  const counts = new Map(), srcCounts = new Map();
  for (const { e, f } of pairs) {
    const a1 = alignEF(e, f, t);
    const a2 = alignFE(e, f, t2);
    const A = symmetrize(a1, a2, e.length, f.length);
    extractPhrases(e, f, A, maxLen, counts, srcCounts);
  }

  // Skorla: φ(tgt|src) = count(src,tgt)/count(src); buda + en iyi adayları tut
  const ptable = new Map();
  for (const [src, mm] of counts) {
    const tot = srcCounts.get(src);
    const scored = [];
    for (const [tgt, c] of mm) if (c >= minCount) scored.push([tgt, c / tot]);
    if (!scored.length) continue;
    scored.sort((a, b) => b[1] - a[1]);
    ptable.set(src, new Map(scored.slice(0, maxCand)));
  }

  const lm = trainLM(tgtTok);
  return { ptable, lm, srcLang, maxPhrase: maxLen };
}

// ---- 5) Öbek-tabanlı monoton beam çözücü ----
export function decodePhrase(eTokens, model, opts = {}) {
  const { ptable, lm, maxPhrase } = model;
  // wordBonus: uretilen her hedef kelime icin odul. Dil modelinin negatif
  // log-olasiliklarini dengeler; olmazsa cozucu "hicbir sey uretmeme"yi secer.
  const { beam = 30, lmWeight = 0.7, topK = 8, wordBonus = 2.5 } = opts;
  const n = eTokens.length;
  const beams = Array.from({ length: n + 1 }, () => []);
  beams[0] = [{ seq: [], h2: "<s>", h1: "<s>", score: 0 }];

  for (let i = 0; i < n; i++) {
    if (!beams[i].length) continue;
    beams[i].sort((a, b) => b.score - a.score);
    beams[i] = beams[i].slice(0, beam);

    for (let len = 1; len <= maxPhrase && i + len <= n; len++) {
      const srcPhrase = eTokens.slice(i, i + len).join(" ");
      const cands = ptable.get(srcPhrase);
      let options;
      if (cands && cands.size) {
        options = [...cands.entries()].sort((a, b) => b[1] - a[1]).slice(0, topK);
      } else if (len === 1) {
        // bilinmeyen tek kelime: oldugu gibi gecir (tercih) ya da düşür
        options = [[eTokens[i], 0.1], ["", 1e-3]];
      } else {
        continue;
      }
      for (const h of beams[i]) {
        for (const [tgtPhrase, p] of options) {
          const words = tgtPhrase === "" ? [] : tgtPhrase.split(" ");
          let h2 = h.h2, h1 = h.h1, sc = h.score + Math.log(p);
          for (const w of words) { sc += lmWeight * lmScore3(lm, h2, h1, w) + wordBonus; h2 = h1; h1 = w; }
          beams[i + len].push({ seq: h.seq.concat(words), h2, h1, score: sc });
        }
      }
    }
  }
  const final = beams[n];
  if (!final.length) return [];
  final.sort((a, b) => b.score - a.score);
  return final[0].seq;
}

// ---- Yeniden sıralamalı çözücü (distorsiyon sınırlı, coverage-tabanlı) ----
// Kaynak öbekleri sıra dışı tüketebilir (örn. İngilizce SVO -> Türkçe SOV).
// Durum: kapsanan kaynak konumlar (bit maskesi) + son bitiş + önceki kelime.
export function decodePhraseReorder(eTokens, model, opts = {}) {
  const { ptable, lm, maxPhrase } = model;
  const {
    beam = 50, lmWeight = 0.7, topK = 8, wordBonus = 2.5,
    distortionLimit = 5, distortionWeight = 0.25,
  } = opts;
  const n = eTokens.length;
  if (n > 30 || n === 0) return decodePhrase(eTokens, model, opts); // emniyet (bit maskesi)
  const full = (1 << n) - 1;

  const optionsFor = (srcPhrase, i, len) => {
    const cands = ptable.get(srcPhrase);
    if (cands && cands.size) {
      return [...cands.entries()].sort((a, b) => b[1] - a[1]).slice(0, topK);
    }
    if (len === 1) return [[eTokens[i], 0.1], ["", 1e-3]];
    return null;
  };

  const stacks = Array.from({ length: n + 1 }, () => []);
  stacks[0] = [{ cov: 0, lastEnd: 0, h2: "<s>", h1: "<s>", seq: [], score: 0 }];

  for (let k = 0; k < n; k++) {
    let st = stacks[k];
    if (!st.length) continue;
    st.sort((a, b) => b.score - a.score);
    st = stacks[k] = st.slice(0, beam);
    for (const h of st) {
      for (let i = 0; i < n; i++) {
        for (let len = 1; len <= maxPhrase && i + len <= n; len++) {
          const mask = ((1 << len) - 1) << i;
          if ((h.cov & mask) !== 0) break; // çakışma; daha uzunu da çakışır
          if (Math.abs(i - h.lastEnd) > distortionLimit) continue;
          const options = optionsFor(eTokens.slice(i, i + len).join(" "), i, len);
          if (!options) continue;
          for (const [tgtPhrase, p] of options) {
            const words = tgtPhrase === "" ? [] : tgtPhrase.split(" ");
            let h2 = h.h2, h1 = h.h1;
            let sc = h.score + Math.log(p) - distortionWeight * Math.abs(i - h.lastEnd);
            for (const w of words) { sc += lmWeight * lmScore3(lm, h2, h1, w) + wordBonus; h2 = h1; h1 = w; }
            stacks[k + len].push({ cov: h.cov | mask, lastEnd: i + len, h2, h1, seq: h.seq.concat(words), score: sc });
          }
        }
      }
    }
  }
  const fin = stacks[n].filter((h) => h.cov === full);
  if (!fin.length) return decodePhrase(eTokens, model, opts);
  fin.sort((a, b) => b.score - a.score);
  return fin[0].seq;
}

export function translatePhrase(model, text, opts = {}) {
  const reorder = opts.reorder !== false; // varsayılan: yeniden sıralama açık
  const out = [];
  for (const sent of splitSentences(text)) {
    const e = tokenize(sent, model.srcLang);
    const dec = reorder ? decodePhraseReorder(e, model, opts) : decodePhrase(e, model, opts);
    out.push(detokenize(dec));
  }
  return out.join(" ");
}

// ---- Modeli sakla / yükle ----
export function serializePhrase(model) {
  return JSON.stringify({
    srcLang: model.srcLang,
    maxPhrase: model.maxPhrase,
    ptable: [...model.ptable].map(([s, m]) => [s, [...m]]),
    lm: {
      uni: [...model.lm.uni], bi: [...model.lm.bi],
      tri: model.lm.tri ? [...model.lm.tri] : [], V: model.lm.V, N: model.lm.N || 0,
    },
  });
}
export function deserializePhrase(json) {
  const o = typeof json === "string" ? JSON.parse(json) : json;
  return {
    srcLang: o.srcLang,
    maxPhrase: o.maxPhrase,
    ptable: new Map(o.ptable.map(([s, m]) => [s, new Map(m)])),
    lm: {
      uni: new Map(o.lm.uni), bi: new Map(o.lm.bi),
      tri: new Map(o.lm.tri || []), V: o.lm.V, N: o.lm.N || 0,
    },
  };
}
