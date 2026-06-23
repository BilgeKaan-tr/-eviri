// Istemci tarafi: dosya secimi/surukleme, yukleme, ilerleme (SSE), indirme + metin cevirisi.

// --- Sunucu modu bilgisi ---
fetch("/api/info").then(r => r.json()).then(({ mode }) => {
  const modelRow = document.getElementById("modelRow");
  const footerMode = document.getElementById("footerMode");
  if (mode === "smt") {
    if (modelRow) modelRow.style.display = "none";
    if (footerMode) footerMode.textContent = "Kendi SMT motoruyla güçlendirilmiştir";
  } else {
    if (footerMode) footerMode.textContent = "Claude API ile güçlendirilmiştir · Türkçe karakter destekli";
  }
}).catch(() => {});

// --- Sekme sistemi ---
const tabs = document.querySelectorAll(".tab");
tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("tab-pdf").classList.toggle("hidden", tab.dataset.tab !== "pdf");
    document.getElementById("tab-text").classList.toggle("hidden", tab.dataset.tab !== "text");
  });
});

// --- PDF sekmesi ---
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
    sessionStorage.setItem("jobId", jobId);
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

// --- Metin sekmesi ---
const textInput = document.getElementById("textInput");
const textOutput = document.getElementById("textOutput");
const translateTextBtn = document.getElementById("translateTextBtn");
const textSpinner = document.getElementById("textSpinner");
const charCount = document.getElementById("charCount");
const copyBtn = document.getElementById("copyBtn");
const copyRow = document.getElementById("copyRow");
const copyOk = document.getElementById("copyOk");

textInput.addEventListener("input", () => {
  charCount.textContent = `${textInput.value.length.toLocaleString("tr")} / 20.000`;
});

translateTextBtn.addEventListener("click", async () => {
  const text = textInput.value.trim();
  if (!text) return;
  translateTextBtn.disabled = true;
  textSpinner.classList.remove("hidden");
  textOutput.value = "";
  copyRow.classList.add("hidden");
  copyOk.classList.add("hidden");

  try {
    const body = { text };
    if (modelSel && modelSel.closest("#modelRow") && !document.getElementById("modelRow").style.display.includes("none")) {
      body.model = modelSel.value;
    }
    const res = await fetch("/api/translate-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Çeviri hatası.");
    textOutput.value = data.result;
    copyRow.classList.remove("hidden");
  } catch (e) {
    textOutput.value = "Hata: " + e.message;
  } finally {
    translateTextBtn.disabled = false;
    textSpinner.classList.add("hidden");
  }
});

copyBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(textOutput.value).then(() => {
    copyOk.classList.remove("hidden");
    setTimeout(() => copyOk.classList.add("hidden"), 2000);
  });
});
