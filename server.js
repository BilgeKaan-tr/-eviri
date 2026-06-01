// PDF Ceviri - Express sunucusu
// Akis: PDF yukle -> metni cikar -> Claude ile Turkceye cevir ->
// yeni PDF olustur. Ilerleme, sayfa sayfa SSE ile istemciye bildirilir.
import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { extractPdf } from "./src/extract.js";
import { translateText } from "./src/translate.js";
import { buildPdf } from "./src/build.js";
import { ensureFonts } from "./scripts/download-font.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Sadece PDF dosyalari kabul edilir."));
  },
});

// Bellek ici is deposu: jobId -> { events[], listeners[], result, done, error, name }
const jobs = new Map();

app.use(express.static(path.join(__dirname, "public")));

// 1) PDF yukle ve isi baslat
app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Dosya bulunamadi." });
  }
  const jobId = crypto.randomUUID();
  const baseName = (req.file.originalname || "belge").replace(/\.pdf$/i, "");
  const job = {
    events: [],
    listeners: [],
    result: null,
    done: false,
    error: null,
    name: `${baseName}-turkce.pdf`,
  };
  jobs.set(jobId, job);

  processJob(jobId, req.file.buffer).catch((err) => {
    job.error = err.message || "Bilinmeyen hata";
    emit(job, { type: "error", message: job.error });
  });

  res.json({ jobId });
});

// 2) Ilerleme akisi (SSE)
app.get("/api/progress/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).end();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // Gecmis olaylari hemen gonder (gec baglanan istemci icin).
  for (const ev of job.events) {
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
  }
  if (job.done || job.error) {
    return res.end();
  }
  const listener = (ev) => {
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
    if (ev.type === "done" || ev.type === "error") res.end();
  };
  job.listeners.push(listener);
  req.on("close", () => {
    job.listeners = job.listeners.filter((l) => l !== listener);
  });
});

// 3) Sonucu indir
app.get("/api/download/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || !job.result) {
    return res.status(404).json({ error: "Sonuc hazir degil." });
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${encodeURIComponent(job.name)}"`
  );
  res.send(Buffer.from(job.result));
  // Indirildikten kisa sure sonra bellegi temizle.
  setTimeout(() => jobs.delete(req.params.jobId), 60_000);
});

function emit(job, event) {
  job.events.push(event);
  for (const l of job.listeners) l(event);
}

async function processJob(jobId, buffer) {
  const job = jobs.get(jobId);
  emit(job, { type: "status", message: "PDF okunuyor..." });

  const { pages } = await extractPdf(buffer);
  const total = pages.length;
  emit(job, { type: "start", total });

  const translatedPages = [];
  for (let i = 0; i < total; i++) {
    emit(job, { type: "progress", page: i + 1, total, phase: "ceviri" });
    const translated = await translateText(pages[i].text);
    translatedPages.push({
      width: pages[i].width,
      height: pages[i].height,
      text: translated,
    });
  }

  emit(job, { type: "status", message: "Cevrilmis PDF olusturuluyor..." });
  job.result = await buildPdf(translatedPages);
  job.done = true;
  emit(job, { type: "done", total });
}

// Sunucuyu baslat (fontlarin var oldugundan emin olarak)
ensureFonts()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`PDF Ceviri calisiyor:  http://localhost:${PORT}`);
      if (!process.env.ANTHROPIC_API_KEY) {
        console.warn(
          "UYARI: ANTHROPIC_API_KEY tanimli degil. .env dosyasi olusturun."
        );
      }
    });
  })
  .catch((err) => {
    console.error("Baslatma hatasi:", err.message);
    process.exit(1);
  });
