// Çok çekirdekli eğitim için iş parçacığı (worker_threads).
// Bir korpus parçasını (cümle çiftleri) alır, öbek modeli eğitir ve
// serileştirilmiş modeli geri gönderir. Ana süreç parçaları birleştirir.
import { parentPort } from "node:worker_threads";
import { buildPhraseModel, serializePhrase } from "../src/mt/phrase.js";

parentPort.on("message", ({ pairs, opts }) => {
  try {
    const model = buildPhraseModel(pairs, opts);
    parentPort.postMessage({ ok: true, json: serializePhrase(model), phrases: model.ptable.size });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
});
