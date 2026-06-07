// Cevrilmis sayfalardan, Turkce karakter destekli (DejaVu Sans) font gomulu
// yeni bir PDF olusturur. Bloklar boyut-duyarli dizilir: basliklar BOLD ve
// daha buyuk; paragraf araliklari korunur. Orijinal sayfa boyutu korunur.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(__dirname, "..", "assets", "fonts");

const MARGIN = 50;
const BODY_SIZE = 11;

// Font baytlarini bir kez oku (her PDF'te disk I/O yapma)
let _reg = null, _bold = null;
const regularBytes = () => (_reg ||= fs.readFileSync(path.join(FONT_DIR, "DejaVuSans.ttf")));
const boldBytes = () => {
  if (_bold === null) {
    const p = path.join(FONT_DIR, "DejaVuSans-Bold.ttf");
    _bold = fs.existsSync(p) ? fs.readFileSync(p) : false;
  }
  return _bold;
};

/**
 * @param {{width:number,height:number,blocks?:{text:string,scale:number,heading:boolean}[],text?:string}[]} pages
 * @returns {Promise<Uint8Array>}
 */
export async function buildPdf(pages) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(regularBytes(), { subset: true });
  const bb = boldBytes();
  const bold = bb ? await pdf.embedFont(bb, { subset: true }) : regular;

  for (const page of pages) {
    const width = page.width || 595, height = page.height || 842;
    let current = pdf.addPage([width, height]);
    let y = height - MARGIN;
    const maxWidth = width - MARGIN * 2;
    // Geriye dönük uyumluluk: blok yoksa düz metni tek blok say
    const blocks = page.blocks || [{ text: page.text || "", scale: 1, heading: false }];

    for (const block of blocks) {
      const size = Math.max(9, Math.min(24, Math.round(BODY_SIZE * (block.scale || 1))));
      const lh = Math.round(size * 1.45);
      const font = block.heading ? bold : regular;
      if (block.heading) y -= lh * 0.5; // başlık öncesi boşluk
      for (const line of wrapPara(block.text, font, size, maxWidth)) {
        if (y < MARGIN) { current = pdf.addPage([width, height]); y = height - MARGIN; }
        if (line) current.drawText(line, { x: MARGIN, y, size, font, color: rgb(0, 0, 0) });
        y -= lh;
      }
      y -= lh * 0.5; // paragraf sonrası boşluk
    }
  }
  return pdf.save();
}

// Bir paragrafi fontun gercek genisliklerine gore satirlara sarmalar.
function wrapPara(text, font, size, maxWidth) {
  const out = [];
  let line = "";
  for (const word of (text || "").split(/\s+/)) {
    if (!word) continue;
    const candidate = line ? line + " " + word : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      out.push(line);
      line = breakLongWord(word, font, size, maxWidth, out);
    } else line = candidate;
  }
  if (line) out.push(line);
  return out;
}

function breakLongWord(word, font, size, maxWidth, out) {
  if (font.widthOfTextAtSize(word, size) <= maxWidth) return word;
  let buf = "";
  for (const ch of word) {
    if (font.widthOfTextAtSize(buf + ch, size) > maxWidth && buf) { out.push(buf); buf = ch; }
    else buf += ch;
  }
  return buf;
}
