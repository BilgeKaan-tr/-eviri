// Node-only: modeli AKIŞLI yaz (tarayıcı tarafı bunu kullanmaz; bundle'a girmez).
// serializePhraseChunks parçalarını doğrudan dosya/gzip akışına yazar; tek bir
// dev JSON dizesi KURULMAZ → V8'in ~512 MB azami dize sınırına takılmaz.
// Büyük öbek tablosunu (Colab/Node) çökmeden kaydetmenin yolu budur.
import fs from "node:fs";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { serializePhraseChunks } from "./phrase.js";

// model'i outPath'e yazar. gzip=true ise .gz uzantısı eklenir ve sıkıştırılır.
// Dönen değer: gerçek yazılan yol.
export async function writePhraseModel(model, outPath, { gzip = false } = {}) {
  let out = outPath;
  if (gzip && !out.endsWith(".gz")) out += ".gz";
  const source = Readable.from(serializePhraseChunks(model)); // parça parça JSON metni
  const dest = fs.createWriteStream(out);
  if (gzip) await pipeline(source, zlib.createGzip({ level: 9 }), dest);
  else await pipeline(source, dest);
  return out;
}
