// PDF'ten metni sayfa sayfa cikarir. Her sayfa, font boyutuna gore baslik/govde
// ayrimi yapilan paragraf BLOKLARINA ayrilir (duzen korumali cikti icin).
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * @param {Buffer} buffer - PDF dosyasinin icerigi
 * @param {{maxPages?:number}} [opts]
 * @returns {Promise<{pages: {width:number,height:number,blocks:{text:string,scale:number,heading:boolean}[]}[]}>}
 */
export async function extractPdf(buffer, opts = {}) {
  const data = new Uint8Array(buffer);
  const doc = await getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;

  if (opts.maxPages && doc.numPages > opts.maxPages) {
    await doc.destroy();
    throw new Error(`PDF çok uzun (${doc.numPages} sayfa). En fazla ${opts.maxPages} sayfa desteklenir.`);
  }

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pages.push({ width: viewport.width, height: viewport.height, blocks: itemsToBlocks(content.items, viewport.width) });
    page.cleanup();
  }
  await doc.destroy();
  return { pages };
}

const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// Çok sütunlu düzen tespiti: iki sütunlu (akademik) PDF'lerde pdf.js parçaları
// satır satır iki sütun arasında gidip gelir; sadece Y boşluğuna bakan blok
// mantığı bu metni iç içe geçirir (anlamsız çıktı). Burada parçalar sayfa
// ortasına göre SOL/SAĞ sütuna ayrılır ve sütunlar ardışık sıralanır (önce
// tüm sol sütun, sonra sağ). Tek sütunda pdf.js'in doğal sırası korunur.
export function orderByColumns(items, pageWidth) {
  const its = items.filter((it) => typeof it.str === "string" && it.transform);
  if (its.length < 4 || !pageWidth) return its;
  const mid = pageWidth / 2;
  let left = 0, right = 0, cross = 0;
  for (const it of its) {
    const x0 = it.transform[4], x1 = x0 + (it.width || 0);
    if (x1 <= mid) left++;
    else if (x0 >= mid) right++;
    else cross++; // orta çizgiyi geçen parça (tek sütun/başlık göstergesi)
  }
  const total = its.length;
  // İki sütun kabulü: her iki yanda yeterli metin VE ortayı geçen parça az
  const twoCol = left > total * 0.25 && right > total * 0.25 && cross < total * 0.15;
  if (!twoCol) return its;
  // Merkezi orta çizginin solunda olan parçalar sol sütun. filter sırayı korur,
  // böylece her sütun içinde pdf.js'in doğal okuma sırası bozulmaz.
  const isLeft = (it) => it.transform[4] + (it.width || 0) / 2 < mid;
  return its.filter(isLeft).concat(its.filter((it) => !isLeft(it)));
}

// pdf.js metin parcalarini paragraf bloklarina ayirir; her bloga temsili font
// boyutu/olcek ve baslik bayragi atar. Tire ile bolunen kelimeler birlestirilir.
function itemsToBlocks(items, pageWidth) {
  items = orderByColumns(items, pageWidth);
  const blocks = [];
  let cur = null, lastY = null;
  for (const it of items) {
    if (typeof it.str !== "string") continue;
    const y = it.transform ? it.transform[5] : null;
    const sz = it.transform ? Math.abs(it.transform[3]) : 0;
    const brk = lastY !== null && y !== null && Math.abs(lastY - y) > 14;
    if (!cur || brk) { if (cur && cur.text.trim()) blocks.push(cur); cur = { text: "", sizes: [] }; }
    if (cur.text && !cur.text.endsWith(" ")) cur.text += " ";
    cur.text += it.str;
    if (sz > 0) cur.sizes.push(sz);
    if (y !== null) lastY = y;
  }
  if (cur && cur.text.trim()) blocks.push(cur);
  for (const b of blocks) {
    b.text = b.text.replace(/(\p{L})-\s+(\p{L})/gu, "$1$2").replace(/\s+/g, " ").trim();
    b.size = median(b.sizes) || 12; delete b.sizes;
  }
  const body = median(blocks.map((b) => b.size)) || 12;
  for (const b of blocks) { b.scale = b.size / body; b.heading = b.size >= body * 1.2 && b.text.length < 120; delete b.size; }
  return blocks.filter((b) => b.text);
}
