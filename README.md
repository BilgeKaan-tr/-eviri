# 📄 PDF Çeviri

PDF dosyalarını **Türkçe'ye** çeviren, **tamamen bağımsız ve çevrimdışı**
çalışabilen bir araç takımı. Sürükle-bırak ile PDF yükleyin; metin çıkarılır,
çevrilir ve **Türkçe karakter destekli** (DejaVu Sans gömülü), başlık/paragraf
düzenini koruyan yeni bir PDF üretilir.

**Yeni başlıyorsanız → [KURULUM.md](KURULUM.md) (sıfırdan adım adım).**  Dört kullanım yolu (detay: [KULLANIM.md](KULLANIM.md)):

| Araç | Açıklama | Bağımlılık |
|---|---|---|
| **`egit.html`** | Kendi motorunu **kitaplarınla eğit** (çok çekirdek, kalite paneli) ve çevir | Yok — tarayıcıda |
| **`cevir-kendi.html`** | Eğittiğin `model.json` ile **çevir** | Yok |
| **`cevir.html`** | Hazır **Meta NLLB-200** modeliyle çevir (ilk açılışta iner) | Bir kez model indirir |
| **Node sunucu** | **Claude API** ile en yüksek kalite | Anthropic kredisi (ücretli) |

- 🔒 **Bağımsız & çevrimdışı:** kendi SMT motorumuz (`src/mt/`) sıfırdan yazıldı;
  paralel kitaplardan öğrenir, hiçbir API/servise muhtaç değildir.
- 🌍 Kaynak dil otomatik (NLLB sürümü) · 🔤 ğ, ş, ı, İ, ç, ö, ü doğru görünür
- 📑 Başlık/paragraf düzeni korunur · 🔁 çeviri önbelleği · ⛔ iptal · 🌓 çift dilli çıktı
- ✅ `npm test` ile 60+ birim test; GitHub Actions CI

> **Benzer projeler:** Düzen-koruyan açık kaynak çeviri için
> [PDFMathTranslate](https://github.com/PDFMathTranslate/PDFMathTranslate)
> (Google/DeepL/OpenAI motorlarıyla) öne çıkar. Bu depo ise **kendi motorunu
> sıfırdan kuran ve tamamen çevrimdışı çalışabilen** olması yönüyle farklıdır.

## 🧪 Kendi çeviri motorumuz (sıfırdan, bağımsız) — `src/mt/`

Hiçbir dış model/servis kullanmadan, **paralel metinden öğrenen** kendi
istatistiksel çeviri motorumuz (SMT). İki dilli (kaynak ↔ Türkçe) hizalı metni
verirsiniz; motor kelime/öbek karşılıklarını öğrenir ve yeni cümleleri çevirir.

İki motor vardır:
- **Öbek-tabanlı (varsayılan, önerilen):** "kelime gruplarını" öğrenir
  (`thank you` → `teşekkür ederim`). İki yönlü IBM-1 hizalaması →
  grow-diag-final-and ile birleştirme → öbek çıkarımı → öbek-tabanlı beam
  çözücü (+ Türkçe dil modeli ve kelime-üretim ödülü). `src/mt/phrase.js`
- **Kelime-tabanlı (basit):** sadece IBM Model 1 kelime hizalaması. `src/mt/engine.js`

```bash
# 0) (İsteğe bağlı) İki ham kitabı otomatik hizala -> TSV
node scripts/mt-align.js --src kitap-en.txt --tgt kitap-tr.txt --out cift.tsv --refine

# 1) Eğit  (öbek-tabanlı varsayılan)
node scripts/mt-train.js --tsv data/ornek-paralel.tsv --out model.json --iter 20

# 2) Çevir  (model türü otomatik algılanır)
node scripts/mt-translate.js --model model.json --text "thank you very much"
# -> Çok teşekkür ederim

# Karşılaştırma gösterimi (öbek vs kelime)
node scripts/mt-phrase-demo.mjs

# (Çok çekirdek) Korpusu parçalara bölüp paralel eğit + birleştir
node scripts/mt-train-parallel.js --tsv data.tsv --out model.json --workers 8

# (Büyük veri) Parça parça eğitip birleştir
node scripts/mt-merge.js --out birlesik.json m1.json m2.json m3.json

# Modeli bir doğrulama setinde BLEU ile değerlendir
node scripts/mt-eval.js --model model.json --dev dev.tsv

# Ağırlıkları doğrulama setinde BLEU'ya göre ayarla ve modele yaz
node scripts/mt-tune.js --model model.json --dev dev.tsv --save
```

**Ek motor özellikleri:**
- `--stem`: Türkçe köke indirgemeli hizalama (büyük veride veri kıtlığını azaltır).
- `mt-merge`: modelleri sayım düzeyinde birleştirir (20.000 kitap → parça parça eğit + topla).
- `--gzip`: model.json'u sıkıştırarak yazar (~5-10x küçük); yükleyiciler otomatik açar.
- `mt-tune`: `lmWeight`/`wordBonus`/`distortionWeight`'i BLEU'ya göre otomatik ayarlar
  (koordinat-yükseliş); ayarlı ağırlıklar modele kaydedilir ve tarayıcıda da kullanılır.

### Tarayıcıda EĞİT + çevir — `egit.html` (kitap yükleme sitesi)

Modeli **doğrudan tarayıcıda** eğitin: birden çok kitap yükleyin, **çok çekirdekli**
eğitim (parçala→worker'larda eğit→birleştir), ve **kalite paneli** (dev BLEU +
otomatik ağırlık ayarı). model.json gerekmez.

1. Kaynaktan üretmek için: `npm run build:web` (src/mt → `egit.html`).
2. `egit.html` + `font-data.js` aynı klasörde; `egit.html`'i açın.
3. **Birden çok TSV** (kaynak⇥türkçe) **veya** birden çok düz **EN + TR kitap**
   dosyası yükleyin → **Eğit** (çekirdek sayısı otomatik; isterseniz girin).
4. (İsteğe bağlı) Bir **dev TSV** verip **BLEU hesapla** / **Otomatik ayarla**.
5. PDF sürükleyin; isterseniz `modeli indir (.gz)`.

### Tarayıcıda kendi motorumuzla PDF çevirme — `cevir-kendi.html`

Eğittiğiniz `model.json` ile PDF'leri **kendi SMT motorumuzla** (öbek + trigram +
reordering) tarayıcıda çevirin. Çeviri tamamen cihazınızda, bizim kodumuzla yapılır
(pdf.js/pdf-lib yalnızca PDF okuma/yazma için).

1. `cevir-kendi.html` ve `font-data.js` aynı klasörde olsun.
2. `cevir-kendi.html`'i açın → **model.json Yükle**.
3. PDF'i sürükleyin; çeviri bitince indirin.

> **Herkese açık yayın için (GitHub Pages vb.):** Eğittiğiniz `model.json.gz`'yi
> `cevir-kendi.html` ile **aynı klasöre** koyarsanız sayfa onu **otomatik yükler** —
> ziyaretçi hiçbir şey seçmeden çevirir. Farklı konum için `?model=URL` kullanın.
> Model bulunamazsa sessizce elle yükleme moduna düşer.

> Tarayıcı motorunun çıktısı, Node motoruyla **birebir aynı** olacak şekilde
> doğrulanmıştır.

**Otomatik hizalama (`mt-align`):** 20.000 kitabı elle eşleştiremezsiniz.
Gale-Church algoritması (cümle uzunluklarına dayalı, dilden bağımsız) iki ham
metni otomatik hizalar; 1-1, 1-2, 2-1, 2-2 eşleşmelerini bulur. `src/mt/align.js`

**Eğitim seçenekleri:** `--iter` (EM turu), `--maxphrase` (en uzun öbek),
`--mincount` (büyük veride 2-3 yapın; nadir öbekleri eler), `--word` (kelime motoru).

**Veri biçimi:** `--tsv` ile her satır `kaynak<TAB>türkçe`; veya `--src en.txt
--tgt tr.txt` ile satır satır hizalı iki dosya.

**Gerçek kalite için (önemli):** 2 kitap çok azdır. Ücretsiz büyük EN-TR korpus indirip eğitin:
```bash
node scripts/mt-fetch-corpus.js --corpus ted --out korpus.tsv
node scripts/mt-train-parallel.js --tsv korpus.tsv --out model.json --workers 8 --stem --gzip
```
Korpuslar: tatoeba/ted/qed/wikimatrix/opensubtitles/ccmatrix (OPUS). Detay: KULLANIM.md.

**Ölçekleme (2000+ kitap):** Veri arttıkça kalite belirgin yükselir. Çok büyük
veride `--mincount 2` (veya 3) verip belleği/dosya boyutunu kontrol edin. Saf JS
eğitim tek çekirdektir; milyonlarca cümlede eğitim uzun sürebilir.

**Dürüst beklenti:** Bu motor *gerçekten öğrenir* ve veri arttıkça gelişir;
tamamen bizim, bağımsız ve çevrimdışıdır. Yine de tavan kalitesi sinir ağı
modellerinin (NLLB/Google) altındadır. Yol haritası: ham kitaplar için otomatik
cümle hizalama, kelime-sırası (reordering) modeli, daha güçlü (trigram) dil modeli,
tarayıcıya entegrasyon.

## ⚡ Tamamen bağımsız sürüm: `cevir.html` (önerilen)

Çeviri modeli **doğrudan cihazınızda, tarayıcının içinde** çalışır.
**Sunucu yok, API yok, token yok, kredi yok.** Model bir kez indikten sonra
**çevrimdışı** çalışır ve hiçbir veriniz cihazınızdan çıkmaz.

1. `cevir.html` ve `font-data.js` dosyalarını **aynı klasörde** tutun.
2. `cevir.html`'i açın (telefon veya bilgisayar fark etmez).
3. **"Modeli İndir ve Hazırla"**ya basın. Meta NLLB-200 modeli ilk seferde
   bir kez (~300–600 MB) iner ve tarayıcınızda saklanır.
4. Model hazır olunca PDF'i sürükleyip bırakın; çeviri bitince indirin.

> **Gereksinimler:** Modern bir cihaz ve tarayıcı. **WebGPU** destekleyen
> tarayıcılarda (güncel Chrome/Edge) çok daha hızlıdır; yoksa WASM ile yavaş
> çalışır. İlk indirme için iyi bir bağlantı ve yeterli depolama gerekir.
>
> **Kaynak dil otomatik algılanır** (tarayıcıda, `franc` ile) ve NLLB ile
> Türkçe'ye çevrilir. Tüm işlem cihazınızda olur.

### Neden tamamen bağımsız?
- Çeviri motoru (NLLB-200) ONNX olarak `transformers.js` ile **cihazda** koşar.
- İlk yüklemeden sonra **internet gerekmez**; metin hiçbir sunucuya gitmez.
- Kalite, telefonda çalışabilen en iyi açık model seviyesindedir (Google'a yakın).

### Özellikler
- 🧵 **Arka planda çalışma:** Çeviri bir Web Worker'da yapılır, arayüz donmaz
  (Worker oluşturulamazsa ana iş parçacığına otomatik geçilir).
- ⚙️ **Otomatik cihaz seçimi:** Önce WebGPU denenir, olmazsa WASM'a düşülür.
- 🚀 **Mod seçimi:** Denge (q8) / Hızlı-düşük bellek (q4) / Kalite (fp16).
- 🔁 **Çeviri önbelleği:** Tekrar eden satırlar (üstbilgi/altbilgi) bir kez çevrilir.
- ⏱️ **İlerleme + kalan süre:** Parça bazında yüzde ve ETA gösterilir.
- ⛔ **İptal:** Çeviriyi istediğiniz an durdurabilirsiniz.
- 💾 **Kalıcı önbellek:** Model, tarayıcıda kalıcı depolanmaya çalışılır (yeniden inmez).

## Alternatif: Claude (Node.js sunucu, en yüksek kalite, ücretli)

Aşağıdaki sunucu sürümü Anthropic Claude API kullanır; en kaliteli çeviriyi
verir ama Anthropic hesabında **kredi** gerektirir.

## Kurulum (Node.js sunucu sürümü)

1. **Bağımlılıkları kurun:**

   ```bash
   npm install
   ```

2. **API anahtarını ayarlayın.** `.env.example` dosyasını `.env` olarak
   kopyalayın ve Anthropic anahtarınızı girin
   (https://console.anthropic.com):

   ```bash
   cp .env.example .env
   # .env dosyasini acip ANTHROPIC_API_KEY degerini doldurun
   ```

3. **Fontları indirin** (ilk çalıştırmada otomatik de yapılır):

   ```bash
   npm run setup
   ```

## Çalıştırma

```bash
npm start
```

Ardından tarayıcıdan **http://localhost:3000** adresini açın. PDF dosyanızı
sürükleyip bırakın, çeviri bittiğinde indirme bağlantısı belirir.

## Nasıl çalışır?

| Aşama | Dosya | Açıklama |
|-------|-------|----------|
| Metin çıkarma | `src/extract.js` | `pdfjs-dist` ile sayfa sayfa metin + boyut |
| Çeviri | `src/translate.js` | Claude API, uzun sayfalar parçalanır, hız sınırında yeniden dener |
| PDF üretme | `src/build.js` | `pdf-lib` + gömülü DejaVu Sans, otomatik satır sarma |
| Sunucu / UI | `server.js`, `public/` | Yükleme, SSE ilerleme, indirme |


## 📊 Rakip karşılaştırması ve bilinen sınırlar

| Özellik | Bu proje | PDFMathTranslate (pdf2zh) | LibreTranslate |
|---|---|---|---|
| Motor | Kendi SMT'imiz + NLLB + (ops.) Claude | NMT/LLM (Google/DeepL/OpenAI) | NMT |
| Tamamen offline & API'siz | ✅ (SMT/NLLB) | Kısmen | ✅ |
| Kendi verinle eğitim | ✅ (tarayıcıda) | ❌ | ❌ |
| Düzen koruma | Başlık/paragraf | Sütun/tablo/formül | — |
| OCR (taranmış PDF) | ❌ | ✅ | — |
| Dil çifti | →Türkçe (kaynak otomatik, NLLB) | 100+ | 29 |
| SMT kalite tavanı (BLEU) | ~15–25 | ~35–55 | ~25–40 |

**Dürüst sınırlar:** Kendi SMT motorumuzun kalite tavanı sinir ağlarının altındadır;
tablo/formül/sütun düzeni ve taranmış (OCR) PDF henüz desteklenmez. Güçlü yanı:
**tam bağımsızlık, kendi verinle eğitim ve gizlilik.** En yüksek kalite için Claude
sunucu sürümü (ücretli) kullanılabilir.

## ⚖️ Lisans ve Atıf

Bu projenin **kendi kodu MIT lisanslıdır** ([LICENSE](LICENSE)) — özgürce
kullanabilir, değiştirebilir, **ticari dahil** dağıtabilirsiniz. Ancak proje,
farklı lisanslı üçüncü-taraf bileşenler içerir; **hangi yolu kullandığınız**
hangi şartlara tabi olduğunuzu belirler:

| Yol | Çeviri motoru | Lisans | Ticari kullanım |
|---|---|---|---|
| `egit.html` / `cevir-kendi.html` | **Kendi SMT'imiz** (`src/mt/`) | **MIT (bizim)** | ✅ Serbest |
| `cevir.html` | **Meta NLLB-200** | **CC-BY-NC 4.0** | ❌ **Yalnızca ticari OLMAYAN** + atıf zorunlu |
| Node sunucu | Anthropic Claude API | Anthropic şartları | API ücretine tabi |

> ⚠️ **Önemli:** `cevir.html` çalışma anında Meta'nın **NLLB-200** modelini indirir.
> Bu model **CC-BY-NC 4.0** ile lisanslıdır: **ticari kullanım yasaktır** ve Meta'ya
> **atıf** gerekir. Tamamen özgür (ticari dahil) bir dağıtım istiyorsanız **kendi SMT
> motorumuzu** (`cevir-kendi.html`) kullanın — o tamamen bizimdir ve MIT'tir.

**Gömülü/üçüncü-taraf bileşenler ve lisansları:**

- **DejaVu Sans** yazı tipi (`font-data.js`, gömülü) — DejaVu/Bitstream Vera serbest
  lisansı (kullanım/dağıtım serbest, atıf önerilir).
- **pdf.js** (`pdfjs-dist`) — Apache-2.0 · **pdf-lib** — MIT · **@pdf-lib/fontkit** — MIT
- **franc** (dil algılama) — MIT · **transformers.js** (`@xenova/transformers`) — Apache-2.0
- **Meta NLLB-200** model ağırlıkları — **CC-BY-NC 4.0** (yalnızca `cevir.html`).

Bu izin-verici bileşenler (Apache-2.0/MIT) ticari kullanıma uygundur; tek
kısıtlama NLLB ağırlıklarındadır. Eğitim için indirilen paralel korpusların
(OPUS: TED, Tatoeba, WikiMatrix vb.) **her birinin kendi lisansı** vardır;
ürettiğiniz modeli dağıtırken kullandığınız korpusun şartlarını kontrol edin
(örn. Tatoeba CC-BY; WikiMatrix CC-BY-SA).

## Notlar

- Çıktı PDF, **okunabilir akış** önceliklidir: orijinal yazı tipleri ve
  birebir piksel düzeni yerine, çevrilen metin kenar boşlukları içinde temiz
  biçimde yeniden dizilir. Karmaşık tablolar/görseller metin olarak taşınmaz.
- Yalnızca **metin tabanlı** PDF'ler desteklenir. Taranmış (resim) PDF'ler
  için önce OCR gerekir (yol haritasında).
- Maksimum dosya boyutu 50 MB.

## Yapılandırma (.env)

| Değişken | Varsayılan | Açıklama |
|----------|-----------|----------|
| `ANTHROPIC_API_KEY` | — | **Zorunlu.** Claude API anahtarı |
| `PORT` | `3000` | Sunucu portu |
| `CLAUDE_MODEL` | `claude-sonnet-4-6` | Kullanılacak model |
