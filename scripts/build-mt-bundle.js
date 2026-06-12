// src/mt modüllerini tek bir tarayıcı paketine (bundle) derler.
//  - import satırlarını atar, `export ` önekini siler
//  - aynı isimli üst-düzey `const` (örn. cOf) tekrarlarını teke indirir
//  - sonunda self.MT'ye eğitim + çeviri API'sini açar
// Çıktı: assets/mt-bundle.js  (worker ve ana iş parçacığı bunu kullanır)
// Ayrıca egit.template.html içindeki /*__MT_BUNDLE__*/ yerine gömüp egit.html üretir.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const MT = path.join(root, "src", "mt");

// Bağımlılık sırasına göre (önce tanımlananlar). turkmorph.js, phrase.js'ten
// ÖNCE gelmeli: phrase.js ondan segmentTokens/glueTokens kullanır (import
// satırları bundle'da silindiği için tanım daha önce gelmek zorunda).
const files = ["engine.js", "morph.js", "turkmorph.js", "trie.js", "phrase.js", "align.js", "tune.js"];

const seenConst = new Set();
let out = "// OTOMATİK ÜRETİLDİ — scripts/build-mt-bundle.js (kaynak: src/mt/*)\n";
for (const f of files) {
  let txt = fs.readFileSync(path.join(MT, f), "utf8");
  // çok satırlı dahil tüm `import ... from "...";` ifadelerini kaldır
  txt = txt.replace(/import[\s\S]*?from\s*["'][^"']+["'];?/g, "");
  txt = txt
    .split("\n")
    .map((line) => line.replace(/^export\s+/, "")) // export öneki
    .filter((line) => {
      // üst-düzey (girintisiz) tekrar eden const'ları ele (cOf gibi)
      const m = line.match(/^const\s+([A-Za-z0-9_$]+)\s*=/);
      if (m) { if (seenConst.has(m[1])) return false; seenConst.add(m[1]); }
      return true;
    })
    .join("\n");
  out += `\n// ===== ${f} =====\n${txt}\n`;
}
out += `
// ---- Tarayıcı/worker API'si ----
self.MT = {
  buildPhraseModel, translatePhrase, serializePhrase, deserializePhrase,
  mergeModels, alignTexts, alignTextsRefine, tuneWeights, evaluate, corpusBleu, tokenize, mergeDictionary,
  buildModel, translate,
};
`;

const bundlePath = path.join(root, "assets", "mt-bundle.js");
fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
fs.writeFileSync(bundlePath, out);
console.log(`✓ bundle: assets/mt-bundle.js (${Math.round(out.length / 1024)} KB)`);

// HTML'leri şablonlardan üret (bundle gömülü). TEK KAYNAK: src/mt.
//  egit.html        : tarayıcıda eğitim + çeviri
//  cevir-kendi.html : model yükleyip PDF çevirme
for (const [tmpl, target] of [["egit.template.html", "egit.html"], ["cevir-kendi.template.html", "cevir-kendi.html"]]) {
  const tmplPath = path.join(root, tmpl);
  if (!fs.existsSync(tmplPath)) continue;
  const html = fs.readFileSync(tmplPath, "utf8").replace("/*__MT_BUNDLE__*/", () => JSON.stringify(out));
  fs.writeFileSync(path.join(root, target), html);
  console.log(`✓ ${target} üretildi (bundle gömülü)`);
}
