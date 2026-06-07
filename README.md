# 📄 PDF Çeviri

PDF dosyalarını **tamamen Türkçe'ye** çeviren bir web uygulaması. Dosyayı
sürükle-bırak ile yükleyin; uygulama metni çıkarır, **Claude API** ile
Türkçe'ye çevirir ve **Türkçe karakter destekli** (DejaVu Sans gömülü) yeni
bir PDF üretir.

- 🌍 Kaynak dil otomatik algılanır → her dilden Türkçe'ye
- 🧠 Bağlam farkındalıklı, eksiksiz çeviri (özetlemez, atlamaz)
- 📑 Sayfa sayfa ilerleme göstergesi
- 🔤 ğ, ş, ı, İ, ç, ö, ü karakterleri çıktıda doğru görünür

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
node scripts/mt-align.js --src kitap-en.txt --tgt kitap-tr.txt --out cift.tsv

# 1) Eğit  (öbek-tabanlı varsayılan)
node scripts/mt-train.js --tsv data/ornek-paralel.tsv --out model.json --iter 20

# 2) Çevir  (model türü otomatik algılanır)
node scripts/mt-translate.js --model model.json --text "thank you very much"
# -> Çok teşekkür ederim

# Karşılaştırma gösterimi (öbek vs kelime)
node scripts/mt-phrase-demo.mjs

# (Büyük veri) Parça parça eğitip birleştir
node scripts/mt-merge.js --out birlesik.json m1.json m2.json m3.json

# Ağırlıkları doğrulama setinde BLEU'ya göre ayarla ve modele yaz
node scripts/mt-tune.js --model model.json --dev dev.tsv --save
```

**Ek motor özellikleri:**
- `--stem`: Türkçe köke indirgemeli hizalama (büyük veride veri kıtlığını azaltır).
- `mt-merge`: modelleri sayım düzeyinde birleştirir (20.000 kitap → parça parça eğit + topla).
- `--gzip`: model.json'u sıkıştırarak yazar (~5-10x küçük); yükleyiciler otomatik açar.
- `mt-tune`: `lmWeight`/`wordBonus`/`distortionWeight`'i BLEU'ya göre otomatik ayarlar
  (koordinat-yükseliş); ayarlı ağırlıklar modele kaydedilir ve tarayıcıda da kullanılır.

### Tarayıcıda EĞİT + çevir — `egit.html` (model.json gerekmez)

Paralel metni (TSV ya da ham iki kitap) verip modeli **doğrudan tarayıcıda,
Web Worker'da** eğitin; sonra PDF çevirin. Hiçbir kurulum/Node gerekmez.

1. Kaynaktan üretmek için: `npm run build:web` (src/mt → `egit.html`).
2. `egit.html` + `font-data.js` aynı klasörde; `egit.html`'i açın.
3. TSV (kaynak⇥türkçe) **veya** iki düz metin (EN + TR) yükleyin → **Eğit**.
4. Model hazır olunca PDF sürükleyin; isterseniz `model.json indir`.

### Tarayıcıda kendi motorumuzla PDF çevirme — `cevir-kendi.html`

Eğittiğiniz `model.json` ile PDF'leri **kendi SMT motorumuzla** (öbek + trigram +
reordering) tarayıcıda çevirin. Çeviri tamamen cihazınızda, bizim kodumuzla yapılır
(pdf.js/pdf-lib yalnızca PDF okuma/yazma için).

1. `cevir-kendi.html` ve `font-data.js` aynı klasörde olsun.
2. `cevir-kendi.html`'i açın → **model.json Yükle**.
3. PDF'i sürükleyin; çeviri bitince indirin.

> Tarayıcı motorunun çıktısı, Node motoruyla **birebir aynı** olacak şekilde
> doğrulanmıştır.

**Otomatik hizalama (`mt-align`):** 20.000 kitabı elle eşleştiremezsiniz.
Gale-Church algoritması (cümle uzunluklarına dayalı, dilden bağımsız) iki ham
metni otomatik hizalar; 1-1, 1-2, 2-1, 2-2 eşleşmelerini bulur. `src/mt/align.js`

**Eğitim seçenekleri:** `--iter` (EM turu), `--maxphrase` (en uzun öbek),
`--mincount` (büyük veride 2-3 yapın; nadir öbekleri eler), `--word` (kelime motoru).

**Veri biçimi:** `--tsv` ile her satır `kaynak<TAB>türkçe`; veya `--src en.txt
--tgt tr.txt` ile satır satır hizalı iki dosya.

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
