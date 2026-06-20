// server.js saf mantık testleri. Modülü import etmek HTTP dinlemesi başlatmaz
// (bootstrap doğrudan çalıştırmaya bağlıdır), bu yüzden güvenle test edilir.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_MODELS, resolveModel, sweep } from "../server.js";

test("resolveModel: geçerli model olduğu gibi döner", () => {
  assert.equal(resolveModel("claude-sonnet-4-6"), "claude-sonnet-4-6");
  assert.equal(resolveModel("claude-opus-4-8"), "claude-opus-4-8");
});

test("resolveModel: geçersiz/boş değer undefined döner (varsayılana düşer)", () => {
  // Regresyon koruması: ALLOWED_MODELS tanımsızken her yükleme çöküyordu.
  assert.equal(resolveModel("uydurma-model"), undefined);
  assert.equal(resolveModel(undefined), undefined);
  assert.equal(resolveModel(""), undefined);
  assert.equal(resolveModel(null), undefined);
});

test("ALLOWED_MODELS: istemcideki üç model tanımlı", () => {
  assert.ok(ALLOWED_MODELS.has("claude-sonnet-4-6"));
  assert.ok(ALLOWED_MODELS.has("claude-opus-4-8"));
  assert.ok(ALLOWED_MODELS.has("claude-haiku-4-5-20251001"));
  assert.equal(ALLOWED_MODELS.size, 3);
});

test("sweep: çağrılabilir ve hata vermez (boş durumda no-op)", () => {
  assert.doesNotThrow(() => sweep());
});
