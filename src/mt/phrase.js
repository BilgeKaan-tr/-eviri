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
import { stemTokens } from "./morph.js";
import { buildPhraseTrie, phraseOptionsAt } from "./trie.js";

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

// ---- 3) Tutarlı öbek çiftlerini çıkar (+ lexical ağırlık) ----
// lex(f̄|ē): öbeğin iç kelime hizalamasından, kelime çeviri olasılıklarıyla
// hesaplanan güven. Nadir/sahte öbekleri bastırır. fLex = t-tablosuyla aynı
// jeton kümesi (stem açıksa köklenmiş hedef).
function extractPhrases(e, f, A, maxLen, counts, srcCounts, fLex, t) {
  const n = e.length;
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
      const lex = lexWeight(e, fLex, i1, i2, jmin, jmax, pts, t);
      let mm = counts.get(src);
      if (!mm) counts.set(src, (mm = new Map()));
      const prev = mm.get(tgt); // [count, maxLex]
      if (prev) { prev[0] += 1; if (lex > prev[1]) prev[1] = lex; }
      else mm.set(tgt, [1, lex]);
      srcCounts.set(src, (srcCounts.get(src) || 0) + 1);
    }
  }
}

const NULLW = " NULL"; // engine.js IBM-1 NULL jetonu ile aynı
function lexWeight(e, fLex, i1, i2, jmin, jmax, pts, t) {
  // her hedef j için, [i1,i2] içinde ona bağlı kaynak kelimeler
  const byJ = new Map();
  for (const [i, j] of pts) {
    if (j >= jmin && j <= jmax && i >= i1 && i <= i2) {
      let a = byJ.get(j); if (!a) byJ.set(j, (a = [])); a.push(i);
    }
  }
  let prod = 1;
  for (let j = jmin; j <= jmax; j++) {
    const fw = fLex[j];
    const is = byJ.get(j);
    let s = 0, cnt = 0;
    if (is && is.length) { for (const i of is) { s += t.get(e[i])?.get(fw) || 0; cnt++; } }
    else { s = t.get(NULLW)?.get(fw) || 0; cnt = 1; } // hizalanmamış -> NULL
    prod *= cnt > 0 ? s / cnt : 1e-9;
    if (prod <= 0) return 1e-9;
  }
  return prod;
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

  // Hizalama için (opt-in) köke indirgeme: çekimli biçimleri birleştirip
  // veri kıtlığını azaltır. Token sayısı değişmediğinden konumlar korunur;
  // öbekler yine YÜZEY biçimden çıkarılır, böylece aşırı-soyma çıktıyı bozmaz.
  const fa = (f) => (opts.stem ? stemTokens(f) : f);
  const alignPairs = pairs.map(({ e, f }) => ({ e, f: fa(f) }));

  // İlerleme: ileri EM %45, geri EM %45, çıkarım+LM %10
  const prog = opts.onProgress || null;
  // İki yönlü IBM-1
  const t = trainIBM1(alignPairs, iterations, prog && ((i, n) => prog(0.45 * i / n, `hizalama (ileri) ${i}/${n}`)));
  const t2 = trainIBM1(alignPairs.map(({ e, f }) => ({ e: f, f: e })), iterations, prog && ((i, n) => prog(0.45 + 0.45 * i / n, `hizalama (geri) ${i}/${n}`)));
  if (prog) prog(0.9, "öbekler çıkarılıyor...");

  // Hizala + öbek çıkar
  const counts = new Map(), srcCounts = new Map();
  for (const { e, f } of pairs) {
    const fs = fa(f);
    const a1 = alignEF(e, fs, t);
    const a2 = alignFE(e, fs, t2);
    const A = symmetrize(a1, a2, e.length, fs.length);
    extractPhrases(e, f, A, maxLen, counts, srcCounts, fs, t); // yüzey öbek, lex için fs/t
  }

  // Ham sayımları sakla (model birleştirme sayım düzeyinde yapılır);
  // olasılık tablosu (φ) bunlardan türetilir.
  const lm = trainLM(tgtTok);
  return {
    pcounts: counts, scounts: srcCounts,
    ptable: derivePtable(counts, srcCounts, { minCount, maxCand }),
    lm, srcLang, maxPhrase: maxLen, minCount, maxCand,
  };
}

// Sayım değerinden [count, lex] oku (eski biçimde değer salt sayıdır)
const cOf = (v) => (Array.isArray(v) ? v[0] : v);
const lexOf = (v) => (Array.isArray(v) ? v[1] : 1);

// Her aday için [φ, lex] üret. φ=count/total; lex=lexical güven (varsa).
export function derivePtable(pcounts, scounts, { minCount = 1, maxCand = 20 } = {}) {
  const ptable = new Map();
  for (const [src, mm] of pcounts) {
    const tot = scounts.get(src);
    const scored = [];
    for (const [tgt, v] of mm) {
      const c = cOf(v);
      if (c >= minCount) scored.push([tgt, [c / tot, lexOf(v)]]);
    }
    if (!scored.length) continue;
    scored.sort((a, b) => b[1][0] - a[1][0]); // φ'ye göre
    ptable.set(src, new Map(scored.slice(0, maxCand)));
  }
  return ptable;
}

// Birden çok modeli SAYIM düzeyinde birleştirir (20.000 kitabı parça parça
// eğitip toplamak için). Öbek sayımları, kaynak sayımları ve LM sayımları toplanır.
export function mergeModels(models) {
  const pc = new Map(), sc = new Map();
  const uni = new Map(), bi = new Map(), tri = new Map();
  let N = 0, maxPhrase = 1;
  const srcLang = models[0] ? models[0].srcLang : "en";
  const addInto = (dst, src) => { for (const [k, c] of src) dst.set(k, (dst.get(k) || 0) + c); };
  for (const m of models) {
    for (const [src, mm] of m.pcounts) {
      let d = pc.get(src); if (!d) pc.set(src, (d = new Map()));
      for (const [tgt, v] of mm) {
        const c = cOf(v), lex = lexOf(v);
        const prev = d.get(tgt);
        if (prev) { prev[0] += c; if (lex > prev[1]) prev[1] = lex; }
        else d.set(tgt, [c, lex]); // [count, maxLex]
      }
    }
    addInto(sc, m.scounts);
    addInto(uni, m.lm.uni); addInto(bi, m.lm.bi);
    if (m.lm.tri) addInto(tri, m.lm.tri);
    N += m.lm.N || 0;
    maxPhrase = Math.max(maxPhrase, m.maxPhrase || 1);
  }
  const lm = { uni, bi, tri, V: uni.size, N };
  return {
    pcounts: pc, scounts: sc, ptable: derivePtable(pc, sc, { minCount: 1, maxCand: 20 }),
    lm, srcLang, maxPhrase, minCount: 1, maxCand: 20,
  };
}

// ---- 5) Öbek-tabanlı monoton beam çözücü ----
export function decodePhrase(eTokens, model, opts = {}) {
  const { ptable, lm, maxPhrase } = model;
  // wordBonus: uretilen her hedef kelime icin odul. Dil modelinin negatif
  // log-olasiliklarini dengeler; olmazsa cozucu "hicbir sey uretmeme"yi secer.
  const { beam = 30, lmWeight = 0.7, topK = 8, wordBonus = 2.5, lexWeight = 0.5 } = opts;
  const n = eTokens.length;
  const trie = model._trie || (model._trie = buildPhraseTrie(ptable));
  const beams = Array.from({ length: n + 1 }, () => []);
  beams[0] = [{ seq: [], h2: "<s>", h1: "<s>", score: 0 }];

  for (let i = 0; i < n; i++) {
    if (!beams[i].length) continue;
    beams[i].sort((a, b) => b.score - a.score);
    beams[i] = beams[i].slice(0, beam);

    for (const { len, options } of phraseOptionsAt(trie, eTokens, i, n, maxPhrase, topK)) {
      for (const h of beams[i]) {
        for (const [tgtPhrase, pv] of options) {
          const words = tgtPhrase === "" ? [] : tgtPhrase.split(" ");
          let h2 = h.h2, h1 = h.h1;
          let sc = h.score + Math.log(cOf(pv)) + lexWeight * Math.log(lexOf(pv));
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
    beam = 50, lmWeight = 0.7, topK = 8, wordBonus = 2.5, lexWeight = 0.5,
    distortionLimit = 5, distortionWeight = 0.25,
  } = opts;
  const n = eTokens.length;
  if (n > 30 || n === 0) return decodePhrase(eTokens, model, opts); // emniyet (bit maskesi)
  const full = (1 << n) - 1;
  const trie = model._trie || (model._trie = buildPhraseTrie(ptable));

  // Her başlangıç konumu için aday (uzunluk, seçenekler) listesini önceden hesapla.
  const optsAt = [];
  for (let i = 0; i < n; i++) optsAt[i] = phraseOptionsAt(trie, eTokens, i, n, maxPhrase, topK);

  const stacks = Array.from({ length: n + 1 }, () => []);
  stacks[0] = [{ cov: 0, lastEnd: 0, h2: "<s>", h1: "<s>", seq: [], score: 0 }];

  for (let k = 0; k < n; k++) {
    let st = stacks[k];
    if (!st.length) continue;
    st.sort((a, b) => b.score - a.score);
    st = stacks[k] = st.slice(0, beam);
    for (const h of st) {
      for (let i = 0; i < n; i++) {
        if (Math.abs(i - h.lastEnd) > distortionLimit) continue;
        for (const { len, options } of optsAt[i]) {
          const mask = ((1 << len) - 1) << i;
          if ((h.cov & mask) !== 0) continue; // çakışma
          for (const [tgtPhrase, pv] of options) {
            const words = tgtPhrase === "" ? [] : tgtPhrase.split(" ");
            let h2 = h.h2, h1 = h.h1;
            let sc = h.score + Math.log(cOf(pv)) + lexWeight * Math.log(lexOf(pv)) - distortionWeight * Math.abs(i - h.lastEnd);
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
  opts = { ...(model.weights || {}), ...opts }; // modelde saklı ayarlı ağırlıklar
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
    minCount: model.minCount || 1,
    maxCand: model.maxCand || 20,
    weights: model.weights || null,
    pcounts: [...model.pcounts].map(([s, m]) => [s, [...m]]),
    scounts: [...model.scounts],
    lm: {
      uni: [...model.lm.uni], bi: [...model.lm.bi],
      tri: model.lm.tri ? [...model.lm.tri] : [], V: model.lm.V, N: model.lm.N || 0,
    },
  });
}
export function deserializePhrase(json) {
  const o = typeof json === "string" ? JSON.parse(json) : json;
  const lm = {
    uni: new Map(o.lm.uni), bi: new Map(o.lm.bi),
    tri: new Map(o.lm.tri || []), V: o.lm.V, N: o.lm.N || 0,
  };
  // Yeni biçim: sayımlar. Eski biçim (ptable) ile de uyumlu.
  if (o.pcounts) {
    const pcounts = new Map(o.pcounts.map(([s, m]) => [s, new Map(m)]));
    const scounts = new Map(o.scounts);
    return {
      srcLang: o.srcLang, maxPhrase: o.maxPhrase,
      minCount: o.minCount || 1, maxCand: o.maxCand || 20,
      weights: o.weights || null,
      pcounts, scounts, lm,
      ptable: derivePtable(pcounts, scounts, { minCount: o.minCount || 1, maxCand: o.maxCand || 20 }),
    };
  }
  return {
    srcLang: o.srcLang, maxPhrase: o.maxPhrase,
    ptable: new Map(o.ptable.map(([s, m]) => [s, new Map(m)])), lm,
  };
}
