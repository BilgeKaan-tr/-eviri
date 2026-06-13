import { test } from "node:test";
import assert from "node:assert/strict";

// translate.js modül-üstünde @anthropic-ai/sdk import eder; bağımlılık kurulu
// değilse dosya çökmek yerine zarifçe atlanır (saf yardımcılar test edilir).
let mod = null;
try { mod = await import("../src/translate.js"); } catch { mod = null; }

test("glossaryBlock: terimleri zorunlu kullanım talimatıyla listeler", { skip: !mod }, () => {
  const b = mod.glossaryBlock({ "neural network": "yapay sinir ağı", "token": "jeton" });
  assert.match(b, /ZORUNLU/);
  assert.match(b, /"neural network" -> "yapay sinir ağı"/);
  assert.match(b, /"token" -> "jeton"/);
});

test("glossaryBlock: boş/yok ise boş döner", { skip: !mod }, () => {
  assert.equal(mod.glossaryBlock(null), "");
  assert.equal(mod.glossaryBlock({}), "");
  assert.equal(mod.glossaryBlock({ "": "x", a: "" }), "");
});

test("contextBlock: önceki çeviriyi 'tekrar çevirme' talimatıyla ekler", { skip: !mod }, () => {
  const b = mod.contextBlock("Bu önceki bölümün çevirisidir.");
  assert.match(b, /TEKRAR CEVIRME/);
  assert.match(b, /önceki bölümün/);
  assert.equal(mod.contextBlock(""), "");
  assert.equal(mod.contextBlock(null), "");
});

test("contextBlock: uzun metni son 500 karaktere kırpar", { skip: !mod }, () => {
  const long = "a".repeat(2000);
  const b = mod.contextBlock(long);
  assert.ok(b.includes("a".repeat(500)));
  assert.ok(!b.includes("a".repeat(501)));
});
