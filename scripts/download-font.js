// DejaVu Sans fontlarini indirir ve assets/fonts altina yerlestirir.
// DejaVu Sans, tam Turkce karakter destegi olan statik bir TTF'dir
// (i, ş, ğ, ç, ö, ü ve buyuk harf hallerini icerir) ve pdf-lib ile
// sorunsuz gomulebilir.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(__dirname, "..", "assets", "fonts");
const ZIP_URL =
  "https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.zip";

const REQUIRED = ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"];

export async function ensureFonts() {
  fs.mkdirSync(FONT_DIR, { recursive: true });
  const missing = REQUIRED.filter(
    (f) => !fs.existsSync(path.join(FONT_DIR, f))
  );
  if (missing.length === 0) return FONT_DIR;

  console.log("Fontlar indiriliyor (DejaVu Sans)...");
  const res = await fetch(ZIP_URL);
  if (!res.ok) {
    throw new Error(
      `Font indirilemedi (HTTP ${res.status}). Internet baglantinizi kontrol edin.`
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dejavu-"));
  const zipPath = path.join(tmp, "fonts.zip");
  fs.writeFileSync(zipPath, buf);
  execFileSync("unzip", ["-o", "-j", zipPath, "*.ttf", "-d", tmp], {
    stdio: "ignore",
  });

  for (const name of REQUIRED) {
    const src = path.join(tmp, name);
    if (!fs.existsSync(src)) {
      throw new Error(`Beklenen font bulunamadi: ${name}`);
    }
    fs.copyFileSync(src, path.join(FONT_DIR, name));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("Fontlar hazir:", FONT_DIR);
  return FONT_DIR;
}

// Dogrudan calistirilirsa indir.
if (import.meta.url === `file://${process.argv[1]}`) {
  ensureFonts().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
