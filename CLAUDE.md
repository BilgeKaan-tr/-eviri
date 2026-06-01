# CLAUDE.md

Bu depo, PDF dosyalarını **tamamen Türkçe'ye** çeviren bir uygulamadır.
İki ayrı dağıtım vardır:

## 1) `cevir.html` — Tamamen bağımsız tarayıcı sürümü (birincil)

Tek dosyalık (yanında `font-data.js` ile), tarayıcıda açılan, **sunucu/API/token/kredi
gerektirmeyen** sürüm. Çeviri modeli (Meta NLLB-200) `transformers.js` ile **cihazda**
çalışır; ilk indirmeden sonra çevrimdışıdır ve hiçbir veri cihazdan çıkmaz.

Mimari (hepsi `cevir.html` içinde):
- **Metin çıkarma:** `pdfjs-dist` (CDN), sayfa sayfa metin + sayfa boyutu.
- **Dil algılama:** `franc` (CDN) → ISO 639-3 → `LANG_MAP` ile NLLB FLORES-200 koduna eşlenir.
  Belge geneli bir `docLang` hesaplanır; kısa sayfalarda buna düşülür.
- **Çeviri motoru (`Engine`):** Önce bir **Web Worker** (Blob + `type:module`) içinde
  `transformers.js` pipeline'ı yüklenir; başarısızsa **ana iş parçacığına** geri dönülür.
  Cihaz seçimi `webgpu → wasm` sırayla denenir. İstek/yanıt `id`'li mesajlaşmayla yürür.
- **Parçalama (`splitText`):** Paragraf → cümle → (gerekirse) sabit boyut. `MAX_CHARS=600`.
- **Önbellek:** Aynı `src + metin` parçaları yeniden çevrilmez (üstbilgi/altbilgi tekrarları).
- **İlerleme:** Tüm parçalar önden çıkarılıp global yüzde + ETA gösterilir; **İptal** desteklenir.
- **PDF üretme (`buildPdf`):** `pdf-lib` + `@pdf-lib/fontkit` (CDN) ve gömülü **DejaVu Sans**
  (`font-data.js`, base64) ile Türkçe karakter destekli çıktı; otomatik satır sarma.
- Mod seçici (`q8`/`q4`/`fp16`) `localStorage`'da; model önbelleği için `storage.persist()`.

Önemli: Bu sürümün bağımlılıkları **CDN'den** gelir (jsdelivr). Geliştirme konteynerinde
CDN'ler engellidir, bu yüzden tarayıcı akışı **burada çalıştırılamaz**; mantık `node --check`
ve birim testlerle doğrulanır. Gerçek test kullanıcının cihazında yapılır.

## 2) Node.js sunucu sürümü (alternatif, Claude API, ücretli)

`server.js` + `src/` + `public/`. Anthropic Claude API ile en yüksek kalite, ama kredi gerektirir.
- `src/extract.js` (pdfjs), `src/translate.js` (Claude, chunk + retry), `src/build.js` (pdf-lib).
- `scripts/download-font.js` DejaVu fontunu indirir. `.env` içinde `ANTHROPIC_API_KEY`.

## 3) Kendi istatistiksel çeviri motoru — `src/mt/`

Sıfırdan, bağımsız SMT motoru. Paralel metinden öğrenir, dış bağımlılık yok.
- `src/mt/engine.js`: tokenize, **IBM Model 1 (EM)** ile `t(tgt|src)`, Türkçe
  bigram dil modeli, monoton beam çözücü (yayvan dağılımlı işlev kelimeleri NULL
  ile düşürülür), `serialize`/`deserialize`, yüksek seviye `buildModel`/`translate`.
- `scripts/mt-train.js` (TSV veya iki hizalı dosya → `model.json`),
  `scripts/mt-translate.js`, `scripts/mt-demo.mjs` (öğrenme kanıtı).
- Tamamen Node ile test edilebilir (tarayıcı/CDN gerekmez). Yol haritası:
  öbek-tabanlı çeviri, otomatik cümle hizalama, tarayıcıya entegrasyon.

## Geliştirme notları
- Tarayıcı tarafı JS değişikliğinden sonra: script'i çıkarıp `node --check` ile sözdizimini doğrula.
- `font-data.js` (~986 KB base64) gereklidir; `cevir.html` ile aynı klasörde bulunmalıdır.
- API anahtarlarını **asla** depoya yazma (geçmişe sızar).
- Saf mantık (parçalama, önbellek, layout) Node ile birim test edilebilir.
