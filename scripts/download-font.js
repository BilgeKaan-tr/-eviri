// DejaVu Sans fontlarini indirir ve assets/fonts altina yerlestirir.
// ZIP yerine TTF dosyalari dogrudan indirilir (unzip gerektirmez).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(__dirname, "..", "assets", "fonts");

const FONTS = {
  "DejaVuSans.ttf":
    "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf",
  "DejaVuSans-Bold.ttf":
    "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf",
};

export async function ensureFonts() {
  fs.mkdirSync(FONT_DIR, { recursive: true });
  const missing = Object.keys(FONTS).filter(
    (f) => !fs.existsSync(path.join(FONT_DIR, f))
  );
  if (missing.length === 0) return FONT_DIR;

  console.log("Fontlar indiriliyor (DejaVu Sans)...");
  for (const name of missing) {
    const url = FONTS[name];
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Font indirilemedi: ${name} (HTTP ${res.status})`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(FONT_DIR, name), buf);
    console.log(`  ${name} hazir (${(buf.length / 1024).toFixed(0)} KB)`);
  }
  console.log("Fontlar hazir:", FONT_DIR);
  return FONT_DIR;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureFonts().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
