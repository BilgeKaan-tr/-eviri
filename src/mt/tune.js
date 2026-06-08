// ============================================================================
//  MERT-benzeri ağırlık ayarı (basitleştirilmiş)
//  Çözücü ağırlıklarını (lmWeight, wordBonus, distortionWeight) küçük bir
//  doğrulama setinde BLEU'yu maksimize edecek şekilde koordinat-yükseliş
//  (line-search) ile otomatik ayarlar.
// ============================================================================
import { tokenize } from "./engine.js";
import { translatePhrase } from "./phrase.js";

function ngramCounts(tokens, n) {
  const m = new Map();
  for (let i = 0; i + n <= tokens.length; i++) {
    const g = tokens.slice(i, i + n).join(" ");
    m.set(g, (m.get(g) || 0) + 1);
  }
  return m;
}

// Korpus BLEU (n=1..maxN), kısa-set için Lin yumuşatması (n>1)
export function corpusBleu(cands, refs, maxN = 4) {
  const clipped = new Array(maxN).fill(0);
  const total = new Array(maxN).fill(0);
  let c = 0, r = 0;
  for (let s = 0; s < cands.length; s++) {
    const cand = cands[s], ref = refs[s];
    c += cand.length; r += ref.length;
    for (let n = 1; n <= maxN; n++) {
      const rc = ngramCounts(ref, n), cc = ngramCounts(cand, n);
      for (const [g, cnt] of cc) {
        total[n - 1] += cnt;
        clipped[n - 1] += Math.min(cnt, rc.get(g) || 0);
      }
    }
  }
  let logsum = 0;
  for (let n = 1; n <= maxN; n++) {
    const num = clipped[n - 1] + (n > 1 ? 1 : 0);
    const den = total[n - 1] + (n > 1 ? 1 : 0);
    const p = den > 0 ? num / den : 0;
    logsum += Math.log(p > 0 ? p : 1e-9);
  }
  const bp = c > r ? 1 : Math.exp(1 - r / Math.max(c, 1));
  return bp * Math.exp(logsum / maxN);
}

// chrF: karakter n-gram F-skoru (Popović 2015). Sondan eklemeli Türkçe için
// kelime-BLEU'dan daha bilgilendirici — doğru kök + yanlış ek tamamen sıfır
// almaz, kısmi kredi alır. beta: geri-çağırmaya verilen ağırlık (chrF1 -> 1).
function charNgrams(s, n) {
  const m = new Map();
  for (let i = 0; i + n <= s.length; i++) {
    const g = s.slice(i, i + n);
    m.set(g, (m.get(g) || 0) + 1);
  }
  return m;
}
export function chrf(cands, refs, maxN = 6, beta = 2) {
  let pNum = 0, pDen = 0, rNum = 0, rDen = 0;
  for (let s = 0; s < cands.length; s++) {
    const c = (cands[s] || "").replace(/\s+/g, " ").trim();
    const r = (refs[s] || "").replace(/\s+/g, " ").trim();
    for (let n = 1; n <= maxN; n++) {
      const cc = charNgrams(c, n), rc = charNgrams(r, n);
      let inter = 0;
      for (const [g, cnt] of cc) inter += Math.min(cnt, rc.get(g) || 0);
      let ct = 0; for (const v of cc.values()) ct += v;
      let rt = 0; for (const v of rc.values()) rt += v;
      pNum += inter; pDen += ct; rNum += inter; rDen += rt;
    }
  }
  const prec = pDen ? pNum / pDen : 0;
  const rec = rDen ? rNum / rDen : 0;
  if (prec + rec === 0) return 0;
  const b2 = beta * beta;
  return ((1 + b2) * prec * rec) / (b2 * prec + rec);
}

// Değerlendirme metriği. metric: "bleu" (varsayılan, geriye dönük uyum) | "chrf".
export function evaluate(model, dev, weights, metric = "bleu") {
  const cands = dev.map((d) => translatePhrase(model, d.src, weights));
  if (metric === "chrf") return chrf(cands, dev.map((d) => d.tgt));
  return corpusBleu(cands.map((c) => tokenize(c, "tr")), dev.map((d) => tokenize(d.tgt, "tr")));
}

// Koordinat-yükseliş: her ağırlığı sırayla grid üzerinde tarar, en iyiyi tutar.
export function tuneWeights(model, dev, opts = {}) {
  const grids = opts.grids || {
    lmWeight: [0.3, 0.5, 0.7, 0.9, 1.2, 1.5],
    wordBonus: [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0],
    distortionWeight: [0.1, 0.2, 0.25, 0.4, 0.6, 1.0],
    lexWeight: [0, 0.25, 0.5, 1.0, 1.5, 2.0],
    invWeight: [0, 0.15, 0.3, 0.5, 0.8],       // ters yön φ(e|f)
    invLexWeight: [0, 0.1, 0.2, 0.4, 0.6],     // ters yön lex(e|f)
  };
  const metric = opts.metric || "bleu"; // "bleu" | "chrf" (Türkçe için chrf önerilir)
  const w = { lmWeight: 0.7, wordBonus: 2.5, distortionWeight: 0.25, lexWeight: 0.5, invWeight: 0.3, invLexWeight: 0.2, reorder: true, ...(opts.init || {}) };
  let best = evaluate(model, dev, w, metric);
  const startBleu = best;
  const passes = opts.passes || 3;
  for (let pass = 0; pass < passes; pass++) {
    let improved = false;
    for (const dim of Object.keys(grids)) {
      let bestVal = w[dim];
      for (const v of grids[dim]) {
        const sc = evaluate(model, dev, { ...w, [dim]: v }, metric);
        if (sc > best + 1e-9) { best = sc; bestVal = v; improved = true; }
      }
      w[dim] = bestVal;
    }
    if (!improved) break;
  }
  return {
    weights: {
      lmWeight: w.lmWeight, wordBonus: w.wordBonus, distortionWeight: w.distortionWeight,
      lexWeight: w.lexWeight, invWeight: w.invWeight, invLexWeight: w.invLexWeight,
    },
    bleu: best, startBleu,
  };
}
