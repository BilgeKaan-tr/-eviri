// Kendi SMT motoruyla çeviri — Claude API gerektirmez.
// translate.js ile aynı arayüz: translateText(text) → Promise<string>
import fs from "node:fs";
import zlib from "node:zlib";
import { deserializePhrase, translatePhrase } from "./mt/phrase.js";

let _model = null;

export function loadModel(modelPath) {
  const buf = fs.readFileSync(modelPath);
  const json = (buf[0] === 0x1f && buf[1] === 0x8b)
    ? zlib.gunzipSync(buf).toString("utf8")
    : buf.toString("utf8");
  _model = deserializePhrase(JSON.parse(json));
  console.log(`SMT model hazır: ${_model.ptable.size} öbek · ${modelPath}`);
  return _model;
}

export async function translateText(text) {
  if (!text || !text.trim()) return "";
  if (!_model) throw new Error("SMT model yüklenmedi. Sunucu başlatılırken loadModel() çağrılmalı.");
  return translatePhrase(_model, text);
}
