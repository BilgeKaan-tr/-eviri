// Çok çekirdekli eğitim için iş parçacığı (worker_threads).
// Bir korpus parçasını (cümle çiftleri) alır, öbek modeli eğitir ve
// serileştirilmiş modeli geri gönderir. Ana süreç parçaları birleştirir.
import { parentPort } from "node:worker_threads";
import { buildPhraseModel, serializePhrase } from "../src/mt/phrase.js";

parentPort.on("message", ({ pairs, opts, wi }) => {
  try {
    const o = Object.assign({}, opts, {
      onProgress: (frac) => parentPort.postMessage({ type: "progress", wi, frac }),
    });
    const model = buildPhraseModel(pairs, o);
    parentPort.postMessage({ type: "done", ok: true, json: serializePhrase(model), phrases: model.ptable.size });
  } catch (err) {
    parentPort.postMessage({ type: "done", ok: false, error: String((err && err.message) || err) });
  }
});
