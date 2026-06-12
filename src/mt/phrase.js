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
  lmScoreKN,
  detokenize,
  restoreCasing,
  polishPunct,
  trUpperFirst,
} from "./engine.js";
import { stemTokens } from "./morph.js";
import { segmentTokens, glueTokens } from "./turkmorph.js";
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
function extractPhrases(e, f, A, maxLen, counts, srcCounts, tgtCounts, fLex, t, t2) {
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
      // İki yönlü lexical güven: lexFE = lex(f̄|ē), lexEF = lex(ē|f̄).
      const lexFE = lexWeight(e, fLex, i1, i2, jmin, jmax, pts, t);
      const lexEF = lexWeightEF(e, fLex, i1, i2, jmin, jmax, pts, t2);
      let mm = counts.get(src);
      if (!mm) counts.set(src, (mm = new Map()));
      const prev = mm.get(tgt); // [count, maxLexFE, maxLexEF]
      if (prev) { prev[0] += 1; if (lexFE > prev[1]) prev[1] = lexFE; if (lexEF > prev[2]) prev[2] = lexEF; }
      else mm.set(tgt, [1, lexFE, lexEF]);
      srcCounts.set(src, (srcCounts.get(src) || 0) + 1);
      tgtCounts.set(tgt, (tgtCounts.get(tgt) || 0) + 1); // φ(e|f) için hedef öbek toplamı
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
// lex(ē|f̄): ters yön. Her KAYNAK kelime için, ona bağlı hedef kelimelerden
// t2 (f->e) olasılıklarının ortalaması; kaynak öbek boyunca çarpılır.
// "hedefte yaygın ama kaynağa nadir" öbekleri bastırır (tek-yön lex'in kaçırdığı).
function lexWeightEF(e, fLex, i1, i2, jmin, jmax, pts, t2) {
  if (!t2) return 1;
  const byI = new Map();
  for (const [i, j] of pts) {
    if (i >= i1 && i <= i2 && j >= jmin && j <= jmax) {
      let a = byI.get(i); if (!a) byI.set(i, (a = [])); a.push(j);
    }
  }
  let prod = 1;
  for (let i = i1; i <= i2; i++) {
    const ew = e[i];
    const js = byI.get(i);
    let s = 0, cnt = 0;
    if (js && js.length) { for (const j of js) { s += t2.get(fLex[j])?.get(ew) || 0; cnt++; } }
    else { s = t2.get(NULLW)?.get(ew) || 0; cnt = 1; } // hizalanmamış -> NULL
    prod *= cnt > 0 ? s / cnt : 1e-9;
    if (prod <= 0) return 1e-9;
  }
  return prod;
}

// ============================================================================
//  Yüksek seviye: model kur / çevir
// ============================================================================
const MAX_SENT_LEN = 250; // aşırı uzun (hatalı hizalanmış) cümleleri ele (hang koruması)
export function buildPhraseModel(parallel, opts = {}) {
  const srcLang = opts.srcLang || "en";
  const iterations = opts.iterations || 12;
  const maxLen = opts.maxPhrase || 4;
  const minCount = opts.minCount || 1;   // büyük veride 2-3 yapın
  const maxCand = opts.maxCand || 20;    // kaynak öbek başına aday sayısı
  // Morfolojik segmentasyon (opt-in): Türkçe yüzey biçimi kök + soyut ek
  // etiketlerine ayrılır; model ekleri bağımsız öğrenir, çıktıda glueTokens ile
  // ünlü uyumlu yüzey biçim sentezlenir. segmentTokens kayıpsız round-trip
  // garantili olduğundan çıktıyı bozmaz. (Bkz. turkmorph.js)
  const segment = !!opts.segment;

  // Tokenize
  const pairs = [], tgtTok = [];
  for (const { src, tgt } of parallel) {
    const e = tokenize(src, srcLang);
    let f = tokenize(tgt, "tr");
    if (segment) f = segmentTokens(f);
    // Aşırı uzun çiftleri ele (hizalama hatası olabilir; IBM-1'i O(|e|×|f|)
    // patlatıp eğitimi kilitler). Gerçek cümleler < ~120 jeton.
    if (e.length && f.length && e.length <= MAX_SENT_LEN && f.length <= MAX_SENT_LEN) {
      pairs.push({ e, f }); tgtTok.push(f);
    }
  }

  // Hizalama için (opt-in) köke indirgeme: çekimli biçimleri birleştirip
  // veri kıtlığını azaltır. Token sayısı değişmediğinden konumlar korunur;
  // öbekler yine YÜZEY biçimden çıkarılır, böylece aşırı-soyma çıktıyı bozmaz.
  // Segmentasyon açıkken hizalama da segment token'ları üzerindedir (stem'e gerek
  // yok; ekler zaten ayrı birim).
  const fa = (f) => (segment ? f : opts.stem ? stemTokens(f) : f);
  const alignPairs = pairs.map(({ e, f }) => ({ e, f: fa(f) }));

  // İlerleme: ileri EM %45, geri EM %45, çıkarım+LM %10
  const prog = opts.onProgress || null;
  // İki yönlü IBM-1
  const t = trainIBM1(alignPairs, iterations, prog && ((i, n) => prog(0.45 * i / n, `hizalama (ileri) ${i}/${n}`)));
  const t2 = trainIBM1(alignPairs.map(({ e, f }) => ({ e: f, f: e })), iterations, prog && ((i, n) => prog(0.45 + 0.45 * i / n, `hizalama (geri) ${i}/${n}`)));
  if (prog) prog(0.9, "öbekler çıkarılıyor...");

  // Hizala + öbek çıkar
  const counts = new Map(), srcCounts = new Map(), tgtCounts = new Map();
  for (const { e, f } of pairs) {
    const fs = fa(f);
    const a1 = alignEF(e, fs, t);
    const a2 = alignFE(e, fs, t2);
    const A = symmetrize(a1, a2, e.length, fs.length);
    extractPhrases(e, f, A, maxLen, counts, srcCounts, tgtCounts, fs, t, t2); // yüzey öbek, lex için fs/t/t2
  }

  // Ham sayımları sakla (model birleştirme sayım düzeyinde yapılır);
  // olasılık tablosu (φ) bunlardan türetilir.
  const lm = trainLM(tgtTok);
  return {
    pcounts: counts, scounts: srcCounts, tcounts: tgtCounts,
    ptable: derivePtable(counts, srcCounts, { minCount, maxCand, tcounts: tgtCounts }),
    lm, srcLang, maxPhrase: maxLen, minCount, maxCand, segmented: segment,
  };
}

// Kullanıcı sözlüğünü modele kat (tek/çok kelimelik öbek olarak).
// entries: [{src, tgt}]. Bilinmeyen kelimelerde otorite sağlar; öğrenilen
// güçlü öbekleri ezmez (sayım ağırlığı ile dengelenir). Trie/çözücü ile uyumlu.
export function mergeDictionary(model, entries, weight = 2) {
  for (const { src, tgt } of entries) {
    const s = tokenize(src, model.srcLang || "en").join(" ");
    const t = tokenize(tgt, "tr").join(" ");
    if (!s || !t) continue;
    let mm = model.pcounts.get(s);
    if (!mm) model.pcounts.set(s, (mm = new Map()));
    const prev = mm.get(t);
    if (prev) prev[0] += weight; else mm.set(t, [weight, 1, 1]); // lex=1 (tam güven, iki yön)
    model.scounts.set(s, (model.scounts.get(s) || 0) + weight);
    if (model.tcounts) model.tcounts.set(t, (model.tcounts.get(t) || 0) + weight);
  }
  model.ptable = derivePtable(model.pcounts, model.scounts, {
    minCount: model.minCount || 1, maxCand: model.maxCand || 20, tcounts: model.tcounts || null,
  });
  delete model._trie; // trie yeniden kurulsun
  return model;
}

// Sayım değerinden alanları oku (eski biçimde değer salt sayıdır).
//  pcounts değeri: [count, lexFE, lexEF]   ptable değeri: [φfe, lexFE, φef, lexEF]
const cOf = (v) => (Array.isArray(v) ? v[0] : v);
const lexOf = (v) => (Array.isArray(v) ? v[1] : 1);
const lexEFOf = (v) => (Array.isArray(v) && v.length >= 3 ? v[2] : 1);
// Ters yön katkısı: yalnızca ptable 4'lüsünde ([φfe, lexFE, φef, lexEF]) vardır;
// eski 2'li değerlerde (UNK/lemma/eski model) 0 döner (skoru etkilemez).
function invScore(pv, invWeight, invLexWeight) {
  if (!Array.isArray(pv) || pv.length < 4) return 0;
  return invWeight * Math.log(pv[2] || 1e-9) + invLexWeight * Math.log(pv[3] || 1e-9);
}

// Her aday için skor vektörü üret:
//  tcounts varsa  -> [φ(f|e), lex(f|e), φ(e|f), lex(e|f)]  (4 özellik)
//  yoksa (eski)   -> [φ(f|e), lex(f|e)]                    (geriye dönük uyum)
export function derivePtable(pcounts, scounts, { minCount = 1, maxCand = 20, tcounts = null } = {}) {
  const ptable = new Map();
  for (const [src, mm] of pcounts) {
    const tot = scounts.get(src);
    const scored = [];
    for (const [tgt, v] of mm) {
      const c = cOf(v);
      if (c < minCount) continue;
      const phiFE = c / tot;
      if (tcounts) {
        const tt = tcounts.get(tgt) || c;
        scored.push([tgt, [phiFE, lexOf(v), c / tt, lexEFOf(v)]]);
      } else {
        scored.push([tgt, [phiFE, lexOf(v)]]);
      }
    }
    if (!scored.length) continue;
    scored.sort((a, b) => b[1][0] - a[1][0]); // φ(f|e)'ye göre
    ptable.set(src, new Map(scored.slice(0, maxCand)));
  }
  return ptable;
}

// Birden çok modeli SAYIM düzeyinde birleştirir (20.000 kitabı parça parça
// eğitip toplamak için). Öbek sayımları, kaynak sayımları ve LM sayımları toplanır.
export function mergeModels(models, opts = {}) {
  const pc = new Map(), sc = new Map(), tc = new Map();
  const uni = new Map(), bi = new Map(), tri = new Map();
  let N = 0, maxPhrase = 1;
  const srcLang = models[0] ? models[0].srcLang : "en";
  const addInto = (dst, src) => { if (src) for (const [k, c] of src) dst.set(k, (dst.get(k) || 0) + c); };
  for (const m of models) {
    for (const [src, mm] of m.pcounts) {
      let d = pc.get(src); if (!d) pc.set(src, (d = new Map()));
      for (const [tgt, v] of mm) {
        const c = cOf(v), lexFE = lexOf(v), lexEF = lexEFOf(v);
        const prev = d.get(tgt);
        if (prev) { prev[0] += c; if (lexFE > prev[1]) prev[1] = lexFE; if (lexEF > prev[2]) prev[2] = lexEF; }
        else d.set(tgt, [c, lexFE, lexEF]); // [count, maxLexFE, maxLexEF]
      }
    }
    addInto(sc, m.scounts);
    addInto(tc, m.tcounts); // hedef öbek sayımları (φ(e|f) için)
    addInto(uni, m.lm.uni); addInto(bi, m.lm.bi);
    if (m.lm.tri) addInto(tri, m.lm.tri);
    N += m.lm.N || 0;
    maxPhrase = Math.max(maxPhrase, m.maxPhrase || 1);
  }
  const lm = { uni, bi, tri, V: uni.size, N };
  // derivePtable:false -> büyük korpus birleştirmede ptable türetmeyi atla
  // (tepe bellek/süre). Yükleyici veya prunePhraseModel gerektiğinde türetir.
  const ptable = opts.derivePtable === false ? undefined : derivePtable(pc, sc, { minCount: 1, maxCand: 20, tcounts: tc });
  return {
    pcounts: pc, scounts: sc, tcounts: tc, ptable,
    lm, srcLang, maxPhrase, minCount: 1, maxCand: 20,
    segmented: models[0] ? !!models[0].segmented : false,
  };
}

// Düşük-sayımlı (gürültülü/tek görülen) öbek çiftlerini eler — BÜYÜK korpuslarda
// bellek ve dosya boyutu için kritik. minCount altı adaylar pcounts'tan atılır;
// öksüz kaynak/hedef sayımları temizlenir. φ orijinal toplamlardan (scounts/
// tcounts) hesaplandığından kalan adayların olasılıkları bozulmaz. ptable yalnızca
// modelde zaten varsa yeniden türetilir (eğitim sırasında serialize öncesi gereksiz
// bellek harcamayı önler; yükleyici nasılsa yeniden türetir).
export function prunePhraseModel(model, { minCount = 2 } = {}) {
  if (!model || minCount <= 1) return model;
  const surviving = new Set();
  for (const [src, mm] of model.pcounts) {
    for (const [tgt, v] of mm) {
      if (cOf(v) < minCount) mm.delete(tgt);
      else surviving.add(tgt);
    }
    if (mm.size === 0) { model.pcounts.delete(src); model.scounts.delete(src); }
  }
  if (model.tcounts) for (const tgt of model.tcounts.keys()) if (!surviving.has(tgt)) model.tcounts.delete(tgt);
  if (model.ptable) {
    model.ptable = derivePtable(model.pcounts, model.scounts, {
      minCount: 1, maxCand: model.maxCand || 20, tcounts: model.tcounts || null,
    });
  }
  delete model._trie;
  return model;
}

// ---- 5) Öbek-tabanlı monoton beam çözücü ----
export function decodePhrase(eTokens, model, opts = {}) {
  const { ptable, lm, maxPhrase } = model;
  // wordBonus: uretilen her hedef kelime icin odul. Dil modelinin negatif
  // log-olasiliklarini dengeler; olmazsa cozucu "hicbir sey uretmeme"yi secer.
  const { beam = 30, lmWeight = 0.7, topK = 8, wordBonus = 2.5, lexWeight = 0.5, invWeight = 0.3, invLexWeight = 0.2 } = opts;
  const lmFn = opts.kn === false ? lmScore3 : lmScoreKN; // varsayılan: Kneser-Ney
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
          let sc = h.score + Math.log(cOf(pv)) + lexWeight * Math.log(lexOf(pv)) + invScore(pv, invWeight, invLexWeight);
          for (const w of words) { sc += lmWeight * lmFn(lm, h2, h1, w) + wordBonus; h2 = h1; h1 = w; }
          beams[i + len].push({ seq: h.seq.concat(words), h2, h1, score: sc });
        }
      }
    }
  }
  const final = beams[n];
  if (!final.length) return opts.returnScore ? { seq: [], score: -Infinity } : [];
  final.sort((a, b) => b.score - a.score);
  return opts.returnScore ? { seq: final[0].seq, score: final[0].score } : final[0].seq;
}

// ---- Yeniden sıralamalı çözücü (distorsiyon sınırlı, coverage-tabanlı) ----
// Kaynak öbekleri sıra dışı tüketebilir (örn. İngilizce SVO -> Türkçe SOV).
// Future cost tablosu: fc[i][j] = [i,j) kaynak aralığını çevirmenin tahmini
// en iyi skoru (LM bağlamı yok sayılır). DP ile alt-aralıklardan birleştirilir.
function computeFutureCosts(optsAt, n, lexWeight, wordBonus, invWeight = 0, invLexWeight = 0) {
  const fc = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(-Infinity));
  // doğrudan: i'den başlayan, tam (j-i) uzunluktaki öbeklerin en iyisi
  for (let i = 0; i < n; i++) {
    for (const { len, options } of optsAt[i]) {
      let best = -Infinity;
      for (const [tgt, pv] of options) {
        const words = tgt === "" ? 0 : tgt.split(" ").length;
        const s = Math.log(cOf(pv)) + lexWeight * Math.log(lexOf(pv)) + invScore(pv, invWeight, invLexWeight) + words * wordBonus;
        if (s > best) best = s;
      }
      fc[i][i + len] = best;
    }
  }
  // birleştir: daha uzun aralıklar alt-aralık toplamından da olabilir
  for (let span = 1; span <= n; span++) {
    for (let i = 0; i + span <= n; i++) {
      const j = i + span;
      for (let k = i + 1; k < j; k++) {
        const v = fc[i][k] + fc[k][j];
        if (v > fc[i][j]) fc[i][j] = v;
      }
    }
  }
  return fc;
}
// Kapsanmamış (cov'da 0 olan) maksimal aralıkların future cost toplamı
function futureOf(cov, fc, n) {
  let total = 0, i = 0;
  while (i < n) {
    if (cov & (1 << i)) { i++; continue; }
    let j = i;
    while (j < n && !(cov & (1 << j))) j++;
    const c = fc[i][j];
    if (c > -Infinity) total += c;
    i = j;
  }
  return total;
}

// Durum: kapsanan kaynak konumlar (bit maskesi) + son bitiş + önceki kelime.
export function decodePhraseReorder(eTokens, model, opts = {}) {
  const { ptable, lm, maxPhrase } = model;
  const {
    beam = 50, lmWeight = 0.7, topK = 8, wordBonus = 2.5, lexWeight = 0.5,
    invWeight = 0.3, invLexWeight = 0.2, distortionLimit = 5, distortionWeight = 0.25,
  } = opts;
  const lmFn = opts.kn === false ? lmScore3 : lmScoreKN; // varsayılan: Kneser-Ney
  const n = eTokens.length;
  if (n === 0) return opts.returnScore ? { seq: [], score: 0 } : [];
  // Uzun cümle: 30-bit maske sınırı. Sabit pencere yerine NOKTALAMA / yan-cümle
  // sınırında böl: böylece SOV yeniden sıralaması bir cümle parçasının ortasından
  // kesilmez (Türkçe'de fiil sona gider; keyfi kesim çıktıyı bozardı). Sınır
  // bulunamazsa en fazla 26 jetonluk pencereye düşülür (maske sınırını korur).
  if (n > 30) {
    const W = 26, seq = [];
    const sub = { ...opts, returnScore: false };
    let s = 0;
    while (s < n) {
      let end = Math.min(s + W, n);
      if (end < n) {
        // [s+5, end) arasında en sağdaki cümle/yan-cümle sınırını ara
        for (let k = end - 1; k > s + 5; k--) {
          const tk = eTokens[k];
          if (tk === "," || tk === ";" || tk === ":" || /[.!?]$/.test(tk)) { end = k + 1; break; }
        }
      }
      seq.push(...decodePhraseReorder(eTokens.slice(s, end), model, sub));
      s = end;
    }
    return opts.returnScore ? { seq, score: 0 } : seq;
  }
  const full = (1 << n) - 1;
  const trie = model._trie || (model._trie = buildPhraseTrie(ptable));

  // Her başlangıç konumu için aday (uzunluk, seçenekler) listesini önceden hesapla.
  const optsAt = [];
  for (let i = 0; i < n; i++) optsAt[i] = phraseOptionsAt(trie, eTokens, i, n, maxPhrase, topK);

  // Future cost: kalan kelimeleri çevirmenin tahmini en iyi skoru. Eşit-kapsamlı
  // hipotezleri adil karşılaştırır (arama hatalarını azaltır). Budama içindir;
  // nihai (tam kapsam) skorunu etkilemez.
  const useFuture = opts.futureCost !== false;
  const fc = useFuture ? computeFutureCosts(optsAt, n, lexWeight, wordBonus, invWeight, invLexWeight) : null;
  const prio = (h) => (fc ? h.score + futureOf(h.cov, fc, n) : h.score);

  const stacks = Array.from({ length: n + 1 }, () => []);
  stacks[0] = [{ cov: 0, lastEnd: 0, h2: "<s>", h1: "<s>", seq: [], score: 0 }];

  for (let k = 0; k < n; k++) {
    let st = stacks[k];
    if (!st.length) continue;
    st.sort((a, b) => prio(b) - prio(a));
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
            let sc = h.score + Math.log(cOf(pv)) + lexWeight * Math.log(lexOf(pv)) + invScore(pv, invWeight, invLexWeight) - distortionWeight * Math.abs(i - h.lastEnd);
            for (const w of words) { sc += lmWeight * lmFn(lm, h2, h1, w) + wordBonus; h2 = h1; h1 = w; }
            stacks[k + len].push({ cov: h.cov | mask, lastEnd: i + len, h2, h1, seq: h.seq.concat(words), score: sc });
          }
        }
      }
    }
  }
  const fin = stacks[n].filter((h) => h.cov === full);
  if (!fin.length) return decodePhrase(eTokens, model, opts);
  fin.sort((a, b) => b.score - a.score);
  return opts.returnScore ? { seq: fin[0].seq, score: fin[0].score } : fin[0].seq;
}

export function translatePhrase(model, text, opts = {}) {
  opts = { ...(model.weights || {}), ...opts }; // modelde saklı ayarlı ağırlıklar
  const reorder = opts.reorder !== false; // varsayılan: yeniden sıralama açık
  const polish = opts.polish !== false; // varsayılan: çıktı cilası açık
  const out = [];
  for (const sent of splitSentences(text)) {
    const e = tokenize(sent, model.srcLang);
    let dec = reorder ? decodePhraseReorder(e, model, opts) : decodePhrase(e, model, opts);
    // Segmentasyonla eğitilmişse: kök + soyut ek token'larını ünlü uyumlu
    // yüzey biçime birleştir.
    if (model.segmented) dec = glueTokens(dec);
    let s = detokenize(dec);
    if (polish) {
      s = restoreCasing(s, sent, model.srcLang); // özel isim büyük harfini geri getir
      s = polishPunct(s);                         // sarkan/çift noktalama temizliği
      s = trUpperFirst(s);                        // cümle başını büyüt
    }
    out.push(s);
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
    segmented: !!model.segmented,
    weights: model.weights || null,
    pcounts: [...model.pcounts].map(([s, m]) => [s, [...m]]),
    scounts: [...model.scounts],
    tcounts: model.tcounts ? [...model.tcounts] : null,
    lm: {
      uni: [...model.lm.uni], bi: [...model.lm.bi],
      tri: model.lm.tri ? [...model.lm.tri] : [], V: model.lm.V, N: model.lm.N || 0,
    },
  });
}
export function deserializePhrase(json, opts = {}) {
  const o = typeof json === "string" ? JSON.parse(json) : json;
  const lm = {
    uni: new Map(o.lm.uni), bi: new Map(o.lm.bi),
    tri: new Map(o.lm.tri || []), V: o.lm.V, N: o.lm.N || 0,
  };
  // Yeni biçim: sayımlar. Eski biçim (ptable) ile de uyumlu.
  if (o.pcounts) {
    const pcounts = new Map(o.pcounts.map(([s, m]) => [s, new Map(m)]));
    const scounts = new Map(o.scounts);
    const tcounts = o.tcounts ? new Map(o.tcounts) : null;
    const base = {
      srcLang: o.srcLang, maxPhrase: o.maxPhrase,
      minCount: o.minCount || 1, maxCand: o.maxCand || 20,
      segmented: !!o.segmented, weights: o.weights || null,
      pcounts, scounts, tcounts, lm,
    };
    // countsOnly: ptable/trie türetmeden döner (birleştirme/budama için; bunlar
    // yalnızca pcounts/scounts/tcounts/lm kullanır). Büyük korpus birleştirmede
    // tepe belleği ve süreyi belirgin düşürür.
    if (opts.countsOnly) return base;
    const ptable = derivePtable(pcounts, scounts, { minCount: o.minCount || 1, maxCand: o.maxCand || 20, tcounts });
    return { ...base, ptable, _trie: buildPhraseTrie(ptable) };
  }
  const ptable = new Map(o.ptable.map(([s, m]) => [s, new Map(m)]));
  return { srcLang: o.srcLang, maxPhrase: o.maxPhrase, ptable, lm, _trie: buildPhraseTrie(ptable) };
}
