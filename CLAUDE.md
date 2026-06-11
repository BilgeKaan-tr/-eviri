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
- `src/extract.js` (pdfjs, **blok/başlık algılama** + tire-birleştirme + maxPages +
  **çok sütun tespiti**: `orderByColumns` iki sütunlu sayfada parçaları SOL/SAĞ
  sütuna ayırıp ardışık sıralar — akademik PDF'lerde iç içe geçmeyi önler),
  `src/translate.js` (Claude, chunk + retry + parça-bazlı kısmi başarı + model param +
  **parçalar arası bağlam** + **terim sözlüğü** `glossaryBlock`/`GLOSSARY_PATH`),
  `src/build.js` (pdf-lib, **başlık=bold/büyük**, font baytları önbellekli).
- `server.js`: güvenlik başlıkları, IP hız sınırı, MAX_JOBS/MAX_PAGES, %PDF magic-byte,
  multer hata yakalama, SSE heartbeat, /api/cancel, paralel+önbellekli blok çevirisi,
  graceful shutdown. `public/`: model seçici, iptal, gizlilik notu, jobId reconnect.
- `scripts/download-font.js` DejaVu (regular+bold) indirir. `.env` içinde `ANTHROPIC_API_KEY`.
- Testler: `test/` (node:test, `npm test`), `scripts/check-html.mjs`, GitHub Actions CI.

## 3) Kendi istatistiksel çeviri motoru — `src/mt/`

Sıfırdan, bağımsız SMT motoru. Paralel metinden öğrenir, dış bağımlılık yok.
- `src/mt/engine.js` (kelime-tabanlı): tokenize (kısaltma-duyarlı splitSentences —
  kısaltma/baş harf/sayı dışında HER ZAMAN böler; dev çift/hang koruması), **IBM Model 1 (EM)** ile
  `t(tgt|src)`, Türkçe trigram dil modeli (interpolasyonlu `lmScore3` + **interpolasyonlu
  Kneser-Ney `lmScoreKN`**: mutlak indirim + süreklilik olasılığı; süreklilik sayımları
  MEVCUT n-gram sayımlarından türetilir → eski modeller yeniden eğitilmeden yararlanır;
  `lm._kn` ilk çağrıda kurulur; tri<2000'de interpolasyona düşer), NULL-düşürmeli monoton
  beam çözücü, `serialize`/`deserialize`, `buildModel`/`translate`. Öbek çözücüler varsayılan
  KN kullanır (`opts.kn:false` ile kapatılır).
- `src/mt/phrase.js` (öbek-tabanlı, **varsayılan**): iki yönlü IBM-1 →
  grow-diag-final-and birleştirme → tutarlı öbek çıkarımı → **4 özellikli skorlama**
  `[φ(f|e), lex(f|e), φ(e|f), lex(e|f)]` (ileri+ters yön; ters yön "hedefte yaygın
  ama kaynağa nadir" öbekleri bastırır — Moses'taki 4-skor) → öbek-tabanlı beam
  çözücü. Sayımlar `[count, lexFE, lexEF]`; hedef öbek sayımları `tcounts` ile
  φ(e|f) türetilir. Aday skoru `logφfe + lexWeight·log lexFE + invWeight·log φef
  + invLexWeight·log lexEF`. Eski 2'li modeller/UNK adayları için ters katkı 0
  (geriye dönük uyumlu). Çözücüde **wordBonus** dil modelinin negatif log
  skorlarını dengeler; yoksa boş çıktı seçilir.
  `decodePhraseReorder`: distorsiyon sınırlı, coverage (bit maskesi) tabanlı
  yeniden sıralama (SVO→SOV). `distortionWeight`/`distortionLimit` ile ayarlanır;
  n>30'da **noktalama/yan-cümle sınırında** bölerek çözer (SOV sıralaması cümle
  parçası ortasından kesilmez). **future cost** (kalan kelimelerin tahmini en iyi
  skoru) ile eşit-kapsamlı hipotezler adil budanır.
- `src/mt/morph.js`: hafif Türkçe stemmer (çekim eki soyma + ünsüz sertleştirme).
  `buildPhraseModel`'de `stem:true` (CLI `--stem`) ile yalnızca HİZALAMA köklerle
  yapılır; öbekler yüzey biçimden çıkar (aşırı-soyma çıktıyı bozmaz). Ünsüz
  sertleştirme YALNIZCA gerçekten ek soyulduğunda uygulanır (yoksa "web"→"wep").
- `src/mt/turkmorph.js`: Türkçe **morfolojik segmentasyon + üretim** (opt-in,
  CLI `--segment`). Eğitimde Türkçe yüzey biçim kök + soyut ek etiketlerine ayrılır
  (`evlerinde`→`ev +LER +POSS +LOC`); model ekleri bağımsız öğrenir, çıktıda
  `glueTokens`/`glueOne` **ünlü uyumu** + ünsüz yumuşamasıyla yüzey biçim sentezler.
  `segmentWord` **kayıpsız round-trip garantili** (yalnızca `glueOne` ile orijinali
  birebir geri veren en derin ayrışmayı seçer) → hatalı analiz çıktıyı bozmaz.
  Yüzey-biçim öbek tavanını kıran asıl mekanizma; mevcut modelleri bozmamak için
  varsayılan KAPALI. Model `segmented` bayrağı serileştirilir.
- `src/mt/trie.js`: önek-ağacı öbek tablosu + **bilinmeyen kelime yedeği**
  (`enLemmas`/`lemmaOptions`: İngilizce çekim eki soyup kökü tabloda arar, φ'ye küçük ceza). Ortak önek paylaşımı + erken-durmalı arama. Çözücüler `model._trie`'yi tembel kurar; `phraseOptionsAt` ile aday alır.
- `src/mt/align.js`: **BANTLI** Gale-Church (köşegen bandı + tipli dizi → binlerce
  cümlelik kitap saniyeler/MB; eski tam matris tarayıcıyı kilitliyordu) + Gale-Church + `alignTextsRefine` (iki geçişli:
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
  `scripts/mt-fetch-corpus.js` (OPUS EN-TR korpus indir+TSV),
  `scripts/mt-tune-demo.mjs`.
- `src/mt/tune.js`: korpus BLEU **ve chrF** (karakter n-gram F2 — sondan eklemeli
  Türkçe için kelime-BLEU'dan daha bilgilendirici; `evaluate(...,metric)`,
  `tuneWeights({metric})`) + MERT-benzeri koordinat-yükseliş ile ağırlık ayarı
  (lmWeight/wordBonus/distortionWeight/lexWeight/**invWeight/invLexWeight**). Ayarlı
  ağırlıklar modelde saklanır (`model.weights`) ve translatePhrase varsayılan kullanır.
  `mt-eval` hem BLEU hem chrF raporlar.
- model.json **gzip** ile sıkıştırılabilir (CLI `--gzip`; tarayıcıda
  CompressionStream). Yükleyiciler .gz / 0x1f8b sihirli baytını otomatik açar.
- `mergeDictionary`: kullanıcı sözlüğünü (kelime/karşılık) tek-kelimelik öbek
  olarak modele katar (bilinmeyen kelime otoritesi); CLI `--dict`, egit.html sözlük yükleme.
- Model artık SAYIM (count) saklar; `derivePtable` ile φ türetilir; `mergeModels`
  birden çok modeli sayım düzeyinde birleştirir (parça parça eğitip toplama).
- **Bellek (büyük korpus):** `prunePhraseModel(model,{minCount})` düşük-sayımlı
  (çoğunlukla tek görülen, gürültülü) öbek çiftlerini eler → bellek + dosya boyutu
  kat kat düşer. `mt-train-parallel`/`mt-train-stream` varsayılan `--mincount 2`;
  worker'lar parça düzeyinde budar + sonucu GZIP geçici dosyaya yazar; ana süreç
  parçaları TEK TEK okuyup `deserializePhrase(...,{countsOnly:true})` +
  `mergeModels(...,{derivePtable:false})` ile birleştirir (ptable/trie türetmeden)
  → tepe bellek ~1 model + birikenle sınırlı. Yüz binlerce cümle ~2 GB heap'e sığar.
  Hâlâ taşarsa: `set NODE_OPTIONS=--max-old-space-size=4096` (Windows) ya da
  `--mincount 3`, daha küçük `--maxphrase`.
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
