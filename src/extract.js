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
    pages.push({ width: viewport.width, height: viewport.height, blocks: itemsToBlocks(content.items) });
    page.cleanup();
  }
  await doc.destroy();
  return { pages };
}

const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// pdf.js metin parcalarini paragraf bloklarina ayirir; her bloga temsili font
// boyutu/olcek ve baslik bayragi atar. Tire ile bolunen kelimeler birlestirilir.
function itemsToBlocks(items) {
  const blocks = [];
  let cur = null, lastY = null, lastSz = 12;
  for (const it of items) {
    if (typeof it.str !== "string") continue;
    const y = it.transform ? it.transform[5] : null;
    const sz = it.transform ? Math.abs(it.transform[3]) : 0;
    // Eşik font boyutuna oranlı: küçük gövde için ~14, büyük başlıklarda büyür.
    // Böylece çok satırlı başlıklar yanlışlıkla ayrı bloklara bölünmez.
    const gap = Math.max(14, (lastSz || 12) * 1.2);
    const brk = lastY !== null && y !== null && Math.abs(lastY - y) > gap;
    if (!cur || brk) { if (cur && cur.text.trim()) blocks.push(cur); cur = { text: "", sizes: [] }; }
    if (cur.text && !cur.text.endsWith(" ")) cur.text += " ";
    cur.text += it.str;
    if (sz > 0) { cur.sizes.push(sz); lastSz = sz; }
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
