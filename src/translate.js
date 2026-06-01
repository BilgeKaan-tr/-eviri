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
- Zaten Turkce olan kisimlari oldugu gibi birak.`;

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
export async function translateText(text) {
  if (!text || !text.trim()) return "";
  const chunks = splitText(text, MAX_CHARS);
  const results = [];
  for (const chunk of chunks) {
    results.push(await translateChunk(chunk));
  }
  return results.join("\n");
}

async function translateChunk(text, attempt = 0) {
  try {
    const msg = await getClient().messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Asagidaki metni Turkceye cevir:\n\n${text}`,
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
      return translateChunk(text, attempt + 1);
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
