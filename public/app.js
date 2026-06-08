// Istemci tarafi: dosya secimi/surukleme, yukleme, ilerleme (SSE), indirme.
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const browseBtn = document.getElementById("browseBtn");

const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const errorEl = document.getElementById("error");

const fileNameEl = document.getElementById("fileName");
const phaseLabel = document.getElementById("phaseLabel");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");

const downloadLink = document.getElementById("downloadLink");
const resetBtn = document.getElementById("resetBtn");
const errorResetBtn = document.getElementById("errorResetBtn");
const errorText = document.getElementById("errorText");
const cancelBtn = document.getElementById("cancelBtn");
const modelSel = document.getElementById("model");

let currentJobId = null;
cancelBtn.addEventListener("click", async () => {
  if (!currentJobId) return;
  cancelBtn.disabled = true;
  progressText.textContent = "İptal ediliyor...";
  try { await fetch(`/api/cancel/${currentJobId}`, { method: "POST" }); } catch {}
});

// --- Dosya secimi ---
browseBtn.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("click", (e) => {
  if (e.target === browseBtn) return;
  fileInput.click();
});
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

// --- Surukle birak ---
["dragenter", "dragover"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  })
);
dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

resetBtn.addEventListener("click", reset);
errorResetBtn.addEventListener("click", reset);

function show(el) {
  for (const s of [dropzone, statusEl, resultEl, errorEl]) {
    s.classList.add("hidden");
  }
  el.classList.remove("hidden");
}

function reset() {
  fileInput.value = "";
  progressFill.style.width = "0%";
  show(dropzone);
}

function fail(message) {
  errorText.textContent = message;
  show(errorEl);
}

async function handleFile(file) {
  if (file.type !== "application/pdf") {
    return fail("Lütfen bir PDF dosyası seçin.");
  }
  fileNameEl.textContent = file.name;
  phaseLabel.textContent = "";
  progressFill.style.width = "0%";
  progressText.textContent = "Dosya yükleniyor...";
  show(statusEl);

  cancelBtn.disabled = false;
  try {
    const form = new FormData();
    form.append("file", file);
    if (modelSel) form.append("model", modelSel.value);
    const res = await fetch("/api/upload", { method: "POST", body: form });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Yükleme başarısız.");
    }
    const { jobId } = await res.json();
    currentJobId = jobId;
    sessionStorage.setItem("jobId", jobId); // sayfa yenilenince yeniden bağlan
    listenProgress(jobId);
  } catch (err) {
    fail(err.message);
  }
}

function listenProgress(jobId) {
  const es = new EventSource(`/api/progress/${jobId}`);
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    switch (ev.type) {
      case "status":
        progressText.textContent = ev.message;
        break;
      case "start":
        phaseLabel.textContent = `0 / ${ev.total} sayfa`;
        progressText.textContent = "Çeviri başlıyor...";
        break;
      case "progress": {
        // Karakter-ağırlıklı pct (varsa) daha doğru; yoksa sayfa oranı
        const pct = ev.pct != null ? ev.pct : Math.round(((ev.page - 1) / ev.total) * 100);
        progressFill.style.width = pct + "%";
        phaseLabel.textContent = `${ev.page} / ${ev.total} sayfa · %${pct}`;
        progressText.textContent = `Çevriliyor... (${ev.page}/${ev.total})`;
        break;
      }
      case "done":
        progressFill.style.width = "100%";
        es.close();
        sessionStorage.removeItem("jobId");
        downloadLink.href = `/api/download/${jobId}`;
        show(resultEl);
        break;
      case "error":
        es.close();
        sessionStorage.removeItem("jobId");
        fail(ev.message || "Çeviri sırasında hata oluştu.");
        break;
    }
  };
  es.onerror = () => {
    es.close();
    // done/error zaten gelmediyse genel hata goster.
    if (!resultEl.classList.contains("hidden")) return;
    if (errorEl.classList.contains("hidden") && statusEl.classList.contains("hidden")) return;
  };
}

// Sayfa yenilenince devam eden işe yeniden bağlan
const pending = sessionStorage.getItem("jobId");
if (pending) {
  fetch(`/api/download/${pending}`, { method: "HEAD" }).catch(() => {});
  currentJobId = pending;
  progressText.textContent = "Devam eden işe bağlanılıyor...";
  show(statusEl);
  listenProgress(pending);
}
