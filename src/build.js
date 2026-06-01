// Cevrilmis sayfa metinlerinden, Turkce karakter destekli (DejaVu Sans)
// font gomulu yeni bir PDF olusturur. Orijinal sayfa boyutlari korunur;
// metin kenar bosluklari icinde sarmalanir, tasarsa devam sayfasi acilir.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(__dirname, "..", "assets", "fonts");

const MARGIN = 50;
const FONT_SIZE = 11;
const LINE_HEIGHT = 16;

/**
 * @param {{width:number,height:number,text:string}[]} pages
 * @returns {Promise<Uint8Array>}
 */
export async function buildPdf(pages) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const regular = await pdf.embedFont(
    fs.readFileSync(path.join(FONT_DIR, "DejaVuSans.ttf")),
    { subset: true }
  );

  for (const page of pages) {
    const width = page.width || 595; // A4 fallback
    const height = page.height || 842;
    let current = pdf.addPage([width, height]);
    let y = height - MARGIN;

    const maxWidth = width - MARGIN * 2;
    const lines = layoutText(page.text, regular, FONT_SIZE, maxWidth);

    for (const line of lines) {
      if (y < MARGIN) {
        current = pdf.addPage([width, height]);
        y = height - MARGIN;
      }
      if (line.length > 0) {
        current.drawText(line, {
          x: MARGIN,
          y,
          size: FONT_SIZE,
          font: regular,
          color: rgb(0, 0, 0),
        });
      }
      y -= LINE_HEIGHT;
    }
  }

  return pdf.save();
}

// Metni, fontun gercek genisliklerine gore satirlara sarmalar.
// Paragraf bosluklarini bos satirla korur.
function layoutText(text, font, size, maxWidth) {
  const out = [];
  const paragraphs = (text || "").split("\n");

  for (const para of paragraphs) {
    if (para.trim() === "") {
      out.push("");
      continue;
    }
    const words = para.split(/\s+/);
    let line = "";
    for (const word of words) {
      const candidate = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        out.push(line);
        line = word;
        // Tek kelime bile satira sigmiyorsa zorla bol.
        line = breakLongWord(line, font, size, maxWidth, out);
      } else {
        line = candidate;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

// Tek bir kelime maxWidth'i asiyorsa karakter bazinda boler.
function breakLongWord(word, font, size, maxWidth, out) {
  if (font.widthOfTextAtSize(word, size) <= maxWidth) return word;
  let buf = "";
  for (const ch of word) {
    if (font.widthOfTextAtSize(buf + ch, size) > maxWidth && buf) {
      out.push(buf);
      buf = ch;
    } else {
      buf += ch;
    }
  }
  return buf;
}
