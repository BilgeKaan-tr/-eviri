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
export function corpusBleu(cands, refs, maxN = 3) {
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

export function evaluate(model, dev, weights) {
  const cands = dev.map((d) => tokenize(translatePhrase(model, d.src, weights), "tr"));
  const refs = dev.map((d) => tokenize(d.tgt, "tr"));
  return corpusBleu(cands, refs);
}

// Koordinat-yükseliş: her ağırlığı sırayla grid üzerinde tarar, en iyiyi tutar.
export function tuneWeights(model, dev, opts = {}) {
  const grids = opts.grids || {
    lmWeight: [0.3, 0.5, 0.7, 0.9, 1.2, 1.5],
    wordBonus: [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0],
    distortionWeight: [0.1, 0.2, 0.25, 0.4, 0.6, 1.0],
  };
  const w = { lmWeight: 0.7, wordBonus: 2.5, distortionWeight: 0.25, reorder: true, ...(opts.init || {}) };
  let best = evaluate(model, dev, w);
  const startBleu = best;
  const passes = opts.passes || 3;
  for (let pass = 0; pass < passes; pass++) {
    let improved = false;
    for (const dim of Object.keys(grids)) {
      let bestVal = w[dim];
      for (const v of grids[dim]) {
        const sc = evaluate(model, dev, { ...w, [dim]: v });
        if (sc > best + 1e-9) { best = sc; bestVal = v; improved = true; }
      }
      w[dim] = bestVal;
    }
    if (!improved) break;
  }
  return { weights: { lmWeight: w.lmWeight, wordBonus: w.wordBonus, distortionWeight: w.distortionWeight }, bleu: best, startBleu };
}
