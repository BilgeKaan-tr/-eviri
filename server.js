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
const MAX_JOBS = parseInt(process.env.MAX_JOBS || "20", 10);     // eşzamanlı iş tavanı
const MAX_PAGES = parseInt(process.env.MAX_PAGES || "300", 10);  // sayfa tavanı (DoS)
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "4", 10); // paralel sayfa çevirisi

// İstemciden gelebilecek geçerli model kimlikleri (public/index.html ile eşleşir).
// Listede olmayan değer yok sayılır; translate.js varsayılanı kullanılır.
export const ALLOWED_MODELS = new Set([
  "claude-sonnet-4-6",
  "claude-opus-4-8",
  "claude-haiku-4-5-20251001",
]);

// İstemciden gelen model değerini doğrular: geçerliyse döndürür, değilse
// undefined (translate.js varsayılanına düşülür). Saf fonksiyon: birim test edilir.
export function resolveModel(model) {
  return ALLOWED_MODELS.has(model) ? model : undefined;
}

// Tamamlanan/iptal/hatalı işlerin bellekte kalış süresi (sweeper temizler).
const JOB_TTL = parseInt(process.env.JOB_TTL_MS || "1800000", 10); // 30 dk

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Sadece PDF dosyalari kabul edilir."));
  },
});

// Bellek ici is deposu: jobId -> { events[], listeners[], result, done, error, name, cancelled }
const jobs = new Map();
let activeJobs = 0;

// --- Güvenlik başlıkları (helmet bağımlılığı olmadan) ---
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  next();
});

// --- Basit hız sınırlayıcı (IP başına pencere içinde istek sayısı) ---
const RL_WINDOW = 60_000, RL_MAX = parseInt(process.env.RATE_LIMIT || "60", 10);
const hits = new Map(); // ip -> { count, reset }
app.use((req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || "?";
  const now = Date.now();
  let h = hits.get(ip);
  if (!h || now > h.reset) { h = { count: 0, reset: now + RL_WINDOW }; hits.set(ip, h); }
  if (++h.count > RL_MAX) return res.status(429).json({ error: "Çok fazla istek. Biraz sonra deneyin." });
  next();
});

app.use(express.static(path.join(__dirname, "public")));

// 1) PDF yukle ve isi baslat (multer hatalarini yakalayarak)
app.post("/api/upload", (req, res) => {
  if (activeJobs >= MAX_JOBS) {
    return res.status(503).json({ error: "Sunucu meşgul, lütfen biraz sonra tekrar deneyin." });
  }
  upload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === "LIMIT_FILE_SIZE" ? "Dosya çok büyük (en fazla 50 MB)." : err.message;
      return res.status(413).json({ error: msg });
    }
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "Dosya bulunamadi." });
    // Gerçek PDF mi? İlk baytlar "%PDF" olmalı (MIME tipi taklit edilebilir)
    const buf = req.file.buffer;
    if (buf.length < 5 || buf.slice(0, 5).toString("latin1") !== "%PDF-") {
      return res.status(400).json({ error: "Geçerli bir PDF dosyası değil." });
    }
    const jobId = crypto.randomUUID();
    const baseName = (req.file.originalname || "belge")
      .replace(/\.pdf$/i, "").replace(/[\/\\:*?"<>| -]/g, "_").slice(0, 80) || "belge";
    const model = resolveModel(req.body && req.body.model);
    const job = { events: [], listeners: [], result: null, done: false, error: null, cancelled: false, name: `${baseName}-turkce.pdf`, createdAt: Date.now() };
    jobs.set(jobId, job);
    activeJobs++;
    processJob(jobId, buf, model)
      .catch((e) => { job.error = e.message || "Bilinmeyen hata"; emit(job, { type: "error", message: job.error }); })
      .finally(() => { activeJobs--; });
    res.json({ jobId });
  });
});

// 2) Ilerleme akisi (SSE) — periyodik heartbeat ile
app.get("/api/progress/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).end();
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  for (const ev of job.events) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  if (job.done || job.error) return res.end();
  const hb = setInterval(() => res.write(": keep-alive\n\n"), 25_000); // proxy/idle koruması
  const listener = (ev) => {
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
    if (ev.type === "done" || ev.type === "error") { clearInterval(hb); res.end(); }
  };
  job.listeners.push(listener);
  req.on("close", () => { clearInterval(hb); job.listeners = job.listeners.filter((l) => l !== listener); });
});

// 3) Sonucu indir
app.get("/api/download/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || !job.result) return res.status(404).json({ error: "Sonuc hazir degil." });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(job.name)}"`);
  res.send(Buffer.from(job.result));
  setTimeout(() => jobs.delete(req.params.jobId), 60_000);
});

// 4) İşi iptal et (gereksiz API harcamasını durdurur)
app.post("/api/cancel/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "İş bulunamadı." });
  job.cancelled = true;
  res.json({ ok: true });
});

function emit(job, event) {
  job.events.push(event);
  for (const l of job.listeners) l(event);
}

// Bellek temizliği: TTL'i dolan işleri ve süresi geçmiş hız-sınırı kayıtlarını
// kaldırır. İndirilmeyen/hatalı işler aksi halde sonsuza dek bellekte kalırdı.
export function sweep(now = Date.now()) {
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL) jobs.delete(id);
  }
  for (const [ip, h] of hits) {
    if (now > h.reset) hits.delete(ip);
  }
}

// Sınırlı eşzamanlılıkla havuz (paralel sayfa çevirisi)
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function processJob(jobId, buffer, model) {
  const job = jobs.get(jobId);
  emit(job, { type: "status", message: "PDF okunuyor..." });

  const { pages } = await extractPdf(buffer, { maxPages: MAX_PAGES });
  const total = pages.length;
  emit(job, { type: "start", total });

  // Tüm blokları düzleştir; paralel + önbellekli çevir (tekrar eden bloklar bir kez)
  const flat = [];
  pages.forEach((pg, pi) => pg.blocks.forEach((b) => flat.push({ pi, b })));
  const totalChars = flat.reduce((s, x) => s + x.b.text.length, 0) || 1;
  const cache = new Map();
  let doneChars = 0, donePages = 0, lastPi = -1;

  await pool(flat, CONCURRENCY, async (item) => {
    if (job.cancelled) { item.t = ""; return; }
    const src = item.b.text;
    let tr = cache.get(src);
    if (tr === undefined) {
      try { tr = await translateText(src, model); }
      catch (e) { tr = src; console.error(`[job ${jobId}] blok çeviri hatası: ${e.message}`); }
      cache.set(src, tr);
    }
    item.t = tr;
    doneChars += src.length;
    if (item.pi !== lastPi) { lastPi = item.pi; donePages = item.pi + 1; }
    emit(job, { type: "progress", page: donePages, total, pct: Math.round((doneChars / totalChars) * 100) });
  });

  if (job.cancelled) { emit(job, { type: "error", message: "İşlem iptal edildi." }); return; }

  // Blokları sayfalara geri grupla (sıra korunur)
  const byPage = pages.map((pg) => ({ width: pg.width, height: pg.height, blocks: [] }));
  for (const item of flat) byPage[item.pi].blocks.push({ text: item.t || "", scale: item.b.scale, heading: item.b.heading });

  emit(job, { type: "status", message: "Cevrilmis PDF olusturuluyor..." });
  job.result = await buildPdf(byPage);
  job.done = true;
  emit(job, { type: "done", total });
}

export { app };

// Sunucuyu baslat (fontlarin var oldugundan emin olarak).
// Yalnızca doğrudan çalıştırıldığında; modül olarak import edilince (testler) atlanır.
function start() {
  return ensureFonts()
    .then(() => {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) console.warn("UYARI: ANTHROPIC_API_KEY tanimli degil. .env dosyasi olusturun.");
      else if (!/^sk-ant-/.test(key)) console.warn("UYARI: ANTHROPIC_API_KEY 'sk-ant-' ile başlamıyor; format hatalı olabilir.");
      const server = app.listen(PORT, () => console.log(`PDF Ceviri calisiyor:  http://localhost:${PORT}`));
      // Süresi dolan işleri/IP kayıtlarını periyodik temizle (5 dk'da bir).
      const sweeper = setInterval(() => sweep(), 5 * 60_000);
      sweeper.unref?.();
      // Düzgün kapanış: aktif bağlantıları boşalt
      for (const sig of ["SIGTERM", "SIGINT"]) {
        process.on(sig, () => { console.log(`\n${sig} alındı, kapanılıyor...`); clearInterval(sweeper); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000); });
      }
      return server;
    })
    .catch((err) => { console.error("Baslatma hatasi:", err.message); process.exit(1); });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start();
}
