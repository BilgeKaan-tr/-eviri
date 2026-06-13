// Claude API kullanarak metni Turkceye cevirir.
// Kaynak dil otomatik algilanir; cikti yalnizca cevrilmis metindir.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
// Cok uzun sayfalari parcalamak icin yaklasik karakter siniri.
const MAX_CHARS = 6000;

const SYSTEM_PROMPT = `Sen profesyonel bir ceviri motorusun. Sana verilen metni,
kaynak dili ne olursa olsun, akici ve dogal bir TURKCE'ye cevir.

Kurallar:
- SADECE cevrilmis metni dondur. Aciklama, yorum, baslik veya not ekleme.
- Metnin tamamini eksiksiz cevir; hicbir cumleyi atlama veya ozetleme.
- Paragraf ve satir yapisini mumkun oldugunca koru.
- Ozel isimler, kod, URL, e-posta ve sayilar oldugu gibi kalsin.
- Metin parcali veya baglamsiz gorunse bile yine de cevir; soru sorma.
- Zaten Turkce olan kisimlari oldugu gibi birak.
- Terminoloji ve uslubu metnin tamaminda TUTARLI tut.`;

// Terim sozlugunu sistem komutuna ekler (tutarli terminoloji icin).
// glossary: { "source term": "hedef terim", ... }
export function glossaryBlock(glossary) {
  if (!glossary) return "";
  const entries = Object.entries(glossary).filter(([s, t]) => s && t);
  if (!entries.length) return "";
  const lines = entries.slice(0, 200).map(([s, t]) => `- "${s}" -> "${t}"`).join("\n");
  return `\n\nTerim sozlugu (bu karsiliklari ZORUNLU kullan):\n${lines}`;
}

// Onceki parcanin sonundan baglam ozeti (terminoloji/uslup tutarliligi icin).
// Modele "devam metni" oldugu, bunun YENIDEN cevrilmemesi gerektigi soylenir.
export function contextBlock(prevTr) {
  if (!prevTr || !prevTr.trim()) return "";
  const tail = prevTr.trim().slice(-500);
  return `Onceki bolumun Turkce cevirisi (yalnizca baglam/terminoloji tutarliligi icin; TEKRAR CEVIRME, ciktiya EKLEME):\n"""${tail}"""\n\n`;
}

let client = null;
function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY tanimli degil. .env dosyasini olusturun."
      );
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Tek bir metin blogunu Turkceye cevirir (gerekirse parcalara boler).
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function translateText(text, opts = {}) {
  // Geriye donuk uyum: ikinci arguman string ise model kabul edilir.
  if (typeof opts === "string") opts = { model: opts };
  const model = opts.model || MODEL;
  const glossary = opts.glossary || null;
  if (!text || !text.trim()) return "";
  const chunks = splitText(text, MAX_CHARS);
  const results = [];
  let prevTr = ""; // onceki parcanin cevirisi -> bir sonrakine baglam
  for (const chunk of chunks) {
    // Kısmi başarı: bir parça başarısız olursa orijinalini koru, sayfayı kurtar
    try {
      const tr = await translateChunk(chunk, model, 0, { glossary, prevTr });
      results.push(tr);
      prevTr = tr;
    } catch (e) {
      console.error(`[translate] parça hatası, orijinal korunuyor: ${e.message}`);
      results.push(chunk);
    }
  }
  return results.join("\n");
}

async function translateChunk(text, model = MODEL, attempt = 0, ctx = {}) {
  try {
    const msg = await getClient().messages.create({
      model,
      max_tokens: 8192,
      system: SYSTEM_PROMPT + glossaryBlock(ctx.glossary),
      messages: [
        {
          role: "user",
          content: `${contextBlock(ctx.prevTr)}Asagidaki metni Turkceye cevir:\n\n${text}`,
        },
      ],
    });
    return msg.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (err) {
    // Hiz siniri / gecici hatalarda ustel bekleme ile yeniden dene.
    const status = err?.status;
    if ((status === 429 || status === 529 || status >= 500) && attempt < 4) {
      const wait = Math.pow(2, attempt) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      return translateChunk(text, model, attempt + 1, ctx);
    }
    throw err;
  }
}

// Metni paragraf sinirlarinda, limiti asmadan parcalara boler.
function splitText(text, limit) {
  if (text.length <= limit) return [text];
  const paragraphs = text.split(/\n{2,}/);
  const chunks = [];
  let current = "";
  for (const p of paragraphs) {
    if (p.length > limit) {
      // Tek paragraf bile cok uzunsa cumlelere bol.
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (const sentence of splitLong(p, limit)) {
        if ((current + sentence).length > limit && current) {
          chunks.push(current);
          current = "";
        }
        current += (current ? " " : "") + sentence;
      }
      continue;
    }
    if ((current + "\n\n" + p).length > limit && current) {
      chunks.push(current);
      current = "";
    }
    current += (current ? "\n\n" : "") + p;
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitLong(text, limit) {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
  const out = [];
  let buf = "";
  for (const s of sentences) {
    if (s.length > limit) {
      // Asiri uzun tek cumle: ham olarak parcala.
      for (let i = 0; i < s.length; i += limit) {
        out.push(s.slice(i, i + limit));
      }
      continue;
    }
    if ((buf + s).length > limit && buf) {
      out.push(buf);
      buf = "";
    }
    buf += s;
  }
  if (buf) out.push(buf);
  return out;
}
