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
- `src/extract.js` (pdfjs, **blok/başlık algılama** + tire-birleştirme + maxPages),
  `src/translate.js` (Claude, chunk + retry + parça-bazlı kısmi başarı + model param),
  `src/build.js` (pdf-lib, **başlık=bold/büyük**, font baytları önbellekli).
- `server.js`: güvenlik başlıkları, IP hız sınırı, MAX_JOBS/MAX_PAGES, %PDF magic-byte,
  multer hata yakalama, SSE heartbeat, /api/cancel, paralel+önbellekli blok çevirisi,
  graceful shutdown. `public/`: model seçici, iptal, gizlilik notu, jobId reconnect.
- `scripts/download-font.js` DejaVu (regular+bold) indirir. `.env` içinde `ANTHROPIC_API_KEY`.
- Testler: `test/` (node:test, `npm test`), `scripts/check-html.mjs`, GitHub Actions CI.

## 3) Kendi istatistiksel çeviri motoru — `src/mt/`

Sıfırdan, bağımsız SMT motoru. Paralel metinden öğrenir, dış bağımlılık yok.
- `src/mt/engine.js` (kelime-tabanlı): tokenize, **IBM Model 1 (EM)** ile
  `t(tgt|src)`, Türkçe trigram dil modeli (interpolasyonlu), NULL-düşürmeli monoton beam çözücü,
  `serialize`/`deserialize`, `buildModel`/`translate`.
- `src/mt/phrase.js` (öbek-tabanlı, **varsayılan**): iki yönlü IBM-1 →
  grow-diag-final-and birleştirme → tutarlı öbek çıkarımı → φ(f̄|ē) skorlama →
  öbek-tabanlı beam çözücü + **lexical weighting** (öbeğin kelime düzeyi güveni
  `lex(f̄|ē)`; sayımlar `[count, lex]` saklanır, aday skoru `logφ + lexWeight·log lex`).
  Çözücüde **wordBonus** (kelime-üretim ödülü) dil
  modelinin negatif log skorlarını dengeler; yoksa boş çıktı seçilir.
  `decodePhraseReorder`: distorsiyon sınırlı, coverage (bit maskesi) tabanlı
  yeniden sıralama (SVO→SOV). `distortionWeight`/`distortionLimit` ile ayarlanır;
  n>30'da güvenli monoton geri dönüş. **future cost** (kalan kelimelerin
  tahmini en iyi skoru) ile eşit-kapsamlı hipotezler adil budanır (küçük
  beam'de arama hatası azalır; skoru asla düşürmez).
- `src/mt/morph.js`: hafif Türkçe stemmer (çekim eki soyma + ünsüz sertleştirme).
  `buildPhraseModel`'de `stem:true` (CLI `--stem`) ile yalnızca HİZALAMA köklerle
  yapılır; öbekler yüzey biçimden çıkar (aşırı-soyma çıktıyı bozmaz).
- `src/mt/trie.js`: önek-ağacı öbek tablosu + **bilinmeyen kelime yedeği**
  (`enLemmas`/`lemmaOptions`: İngilizce çekim eki soyup kökü tabloda arar, φ'ye küçük ceza). Ortak önek paylaşımı + erken-durmalı arama. Çözücüler `model._trie`'yi tembel kurar; `phraseOptionsAt` ile aday alır.
- `src/mt/align.js`: Gale-Church cümle hizalama + `alignTextsRefine` (iki geçişli:
  uzunluk → IBM-1 → uzunluk+lexical; gürültülü kitap çiftlerinde daha sağlam).
- `egit.html`: PDF kitap yükleme (pdf.js metin çıkarma), modeli IndexedDB'de saklama
  (otomatik geri yükleme), refine hizalama ile eğitim.
- `egit.html` (+ `egit.template.html`, `scripts/build-mt-bundle.js`): tarayıcıda
  **Web Worker'da eğitim** + çeviri. src/mt tek bir bundle'a derlenir
  (`assets/mt-bundle.js`, gömülü); worker hem hizalama hem **çok çekirdekli** eğitim (parçala→eğit→birleştir) hem **otomatik ağırlık ayarı** (BLEU) yapar; çoklu kitap yükleme + kalite paneli.
  `npm run build:web` ile üretilir. Tek kaynak: src/mt.
- `cevir-kendi.html`: kendi motorumuzu tarayıcıya gömer; `model.json` yükleyip
  PDF çevirir (çıktı Node motoruyla birebir aynı doğrulandı).
- CLI: `scripts/mt-train.js` (varsayılan öbek; `--word` ile kelime; `--maxphrase`,
  `--mincount`, `--iter`), `scripts/mt-translate.js` (model türünü otomatik algılar),
  `scripts/mt-phrase-demo.mjs`, `scripts/mt-morph-demo.mjs`, `scripts/mt-demo.mjs`,
  `scripts/mt-align.js`, `scripts/mt-merge.js`, `scripts/mt-tune.js`, `scripts/mt-eval.js`,
  `scripts/mt-train-parallel.js` (+`mt-train-worker.mjs`, çok çekirdekli), `scripts/mt-train-stream.js` (akışlı/bellek-dostu),
  `scripts/mt-tune-demo.mjs`.
- `src/mt/tune.js`: korpus BLEU + MERT-benzeri koordinat-yükseliş ile ağırlık
  ayarı (lmWeight/wordBonus/distortionWeight). Ayarlı ağırlıklar modelde saklanır
  (`model.weights`) ve translatePhrase varsayılan olarak kullanır (tarayıcı dahil).
- model.json **gzip** ile sıkıştırılabilir (CLI `--gzip`; tarayıcıda
  CompressionStream). Yükleyiciler .gz / 0x1f8b sihirli baytını otomatik açar.
- `mergeDictionary`: kullanıcı sözlüğünü (kelime/karşılık) tek-kelimelik öbek
  olarak modele katar (bilinmeyen kelime otoritesi); CLI `--dict`, egit.html sözlük yükleme.
- Model artık SAYIM (count) saklar; `derivePtable` ile φ türetilir; `mergeModels`
  birden çok modeli sayım düzeyinde birleştirir (parça parça eğitip toplama).
- Tamamen Node ile test edilebilir (tarayıcı/CDN gerekmez). Yol haritası:
  otomatik cümle hizalama, reordering, tarayıcıya entegrasyon.

Çıktı PDF blok-tabanlı dizilir: `itemsToBlocks` font boyutundan başlık algılar,
`buildPdf` başlıkları büyük yazar, paragraf aralıklarını korur (egit.html + cevir-kendi.html).
Kullanıcıya yönelik adım adım rehber: `KULLANIM.md`.

## Geliştirme notları
- Tarayıcı tarafı JS değişikliğinden sonra: script'i çıkarıp `node --check` ile sözdizimini doğrula.
- `font-data.js` (~986 KB base64) gereklidir; `cevir.html` ile aynı klasörde bulunmalıdır.
- API anahtarlarını **asla** depoya yazma (geçmişe sızar).
- Saf mantık (parçalama, önbellek, layout) Node ile birim test edilebilir.
