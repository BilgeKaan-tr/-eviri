// Çok çekirdekli eğitim için iş parçacığı (worker_threads).
// Bir korpus parçasını (cümle çiftleri) alır, öbek modeli eğitir ve sonucu
// GZIP'li geçici dosyaya yazar (mesajla dev JSON taşımak yerine — düşük bellek).
// Ana süreç dosyaları sırayla okuyup birleştirir.
import { parentPort } from "node:worker_threads";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { buildPhraseModel, serializePhrase, prunePhraseModel } from "../src/mt/phrase.js";

parentPort.on("message", ({ pairs, opts, wi }) => {
  try {
    const o = Object.assign({}, opts, {
      onProgress: (frac) => parentPort.postMessage({ type: "progress", wi, frac }),
    });
    const model = buildPhraseModel(pairs, o);
    // BELLEK: düşük-sayımlı (çoğunlukla tek görülen, gürültülü) öbek çiftlerini
    // parça düzeyinde ele. Bu, hem worker çıktısını hem de sonraki birleştirmeyi
    // küçültür (büyük korpusta heap taşmasını önleyen ana etken).
    if (opts.minCount > 1) prunePhraseModel(model, { minCount: opts.minCount });
    const json = serializePhrase(model);
    const file = path.join(os.tmpdir(), `mtchunk-${process.pid}-${wi}-${Date.now()}.json.gz`);
    fs.writeFileSync(file, zlib.gzipSync(json, { level: 6 }));
    parentPort.postMessage({ type: "done", ok: true, file, phrases: model.ptable.size });
  } catch (err) {
    parentPort.postMessage({ type: "done", ok: false, error: String((err && err.message) || err) });
  }
});
