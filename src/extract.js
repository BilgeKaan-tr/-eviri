// PDF'ten metni sayfa sayfa cikarir. Her sayfa icin satirlara ayrilmis
// duz metin ve orijinal sayfa boyutlarini dondurur.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * @param {Buffer} buffer - PDF dosyasinin icerigi
 * @returns {Promise<{pages: {width:number,height:number,text:string}[]}>}
 */
export async function extractPdf(buffer) {
  const data = new Uint8Array(buffer);
  const doc = await getDocument({
    data,
    useSystemFonts: true,
    // Konsolu uyarilarla doldurmasin
    verbosity: 0,
  }).promise;

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const text = itemsToText(content.items);
    pages.push({
      width: viewport.width,
      height: viewport.height,
      text,
    });
    page.cleanup();
  }
  await doc.destroy();
  return { pages };
}

// pdf.js metin parcalarini, satir sonlarini ve paragraf bosluklarini
// koruyarak okunabilir duz metne cevirir.
function itemsToText(items) {
  let out = "";
  let lastY = null;
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const y = item.transform ? item.transform[5] : null;

    if (lastY !== null && y !== null) {
      const dy = Math.abs(lastY - y);
      if (dy > 14) {
        // Buyuk dikey atlama -> paragraf
        out += "\n\n";
      } else if (dy > 2) {
        // Yeni satir
        out += "\n";
      } else if (out && !out.endsWith(" ") && !out.endsWith("\n")) {
        out += " ";
      }
    }

    out += item.str;
    if (item.hasEOL) out += "\n";
    if (y !== null) lastY = y;
  }
  return collapse(out);
}

function collapse(text) {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
