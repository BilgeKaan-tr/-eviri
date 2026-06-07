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
- `src/mt/engine.js` (kelime-tabanlı): tokenize, **IBM Model 1 (EM)** ile
  `t(tgt|src)`, Türkçe trigram dil modeli (interpolasyonlu), NULL-düşürmeli monoton beam çözücü,
  `serialize`/`deserialize`, `buildModel`/`translate`.
- `src/mt/phrase.js` (öbek-tabanlı, **varsayılan**): iki yönlü IBM-1 →
  grow-diag-final-and birleştirme → tutarlı öbek çıkarımı → φ(f̄|ē) skorlama →
  öbek-tabanlı beam çözücü. Çözücüde **wordBonus** (kelime-üretim ödülü) dil
  modelinin negatif log skorlarını dengeler; yoksa boş çıktı seçilir.
  `decodePhraseReorder`: distorsiyon sınırlı, coverage (bit maskesi) tabanlı
  yeniden sıralama (SVO→SOV). `distortionWeight`/`distortionLimit` ile ayarlanır;
  n>30'da güvenli monoton geri dönüş.
- `src/mt/align.js`: Gale-Church otomatik cümle hizalama (ham metin → çiftler).
- `cevir-kendi.html`: kendi motorumuzu tarayıcıya gömer; `model.json` yükleyip
  PDF çevirir (çıktı Node motoruyla birebir aynı doğrulandı).
- CLI: `scripts/mt-train.js` (varsayılan öbek; `--word` ile kelime; `--maxphrase`,
  `--mincount`, `--iter`), `scripts/mt-translate.js` (model türünü otomatik algılar),
  `scripts/mt-phrase-demo.mjs` (öbek vs kelime), `scripts/mt-demo.mjs`.
- Tamamen Node ile test edilebilir (tarayıcı/CDN gerekmez). Yol haritası:
  otomatik cümle hizalama, reordering, tarayıcıya entegrasyon.

## Geliştirme notları
- Tarayıcı tarafı JS değişikliğinden sonra: script'i çıkarıp `node --check` ile sözdizimini doğrula.
- `font-data.js` (~986 KB base64) gereklidir; `cevir.html` ile aynı klasörde bulunmalıdır.
- API anahtarlarını **asla** depoya yazma (geçmişe sızar).
- Saf mantık (parçalama, önbellek, layout) Node ile birim test edilebilir.
