// cevir-kendi.html + font-data.js -> cevir-kendi-tek.html (TEK, bağımsız dosya).
// Neden: Android/tablet HTML'i content:// ile açınca göreli <script src="font-data.js">
// YÜKLENMEZ → window.FONT_B64 boş → atob hatası. Fontu HTML'e gömünce tek dosya
// her yerde (içeriğe çift tıkla) çalışır. (pdf-lib/pdfjs CDN'leri internetten gelir.)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = path.join(root, "cevir-kendi.html");
const fontPath = path.join(root, "font-data.js");
const outPath = path.join(root, "cevir-kendi-tek.html");

let html = fs.readFileSync(htmlPath, "utf8");
const font = fs.readFileSync(fontPath, "utf8");

// <script src="font-data.js"></script> -> gömülü <script>...font...</script>
const tag = /<script\s+src=["']font-data\.js["']\s*>\s*<\/script>/i;
if (!tag.test(html)) {
  console.error("Hata: cevir-kendi.html içinde <script src=\"font-data.js\"> bulunamadı.");
  process.exit(1);
}
html = html.replace(tag, `<script>\n/* font-data.js gömülü (tek dosya) */\n${font}\n</script>`);

fs.writeFileSync(outPath, html);
console.log(`✓ cevir-kendi-tek.html üretildi (${Math.round(html.length / 1024)} KB) — font gömülü, tek dosya.`);
