# 📄 PDF Çeviri

PDF dosyalarını **tamamen Türkçe'ye** çeviren bir web uygulaması. Dosyayı
sürükle-bırak ile yükleyin; uygulama metni çıkarır, **Claude API** ile
Türkçe'ye çevirir ve **Türkçe karakter destekli** (DejaVu Sans gömülü) yeni
bir PDF üretir.

- 🌍 Kaynak dil otomatik algılanır → her dilden Türkçe'ye
- 🧠 Bağlam farkındalıklı, eksiksiz çeviri (özetlemez, atlamaz)
- 📑 Sayfa sayfa ilerleme göstergesi
- 🔤 ğ, ş, ı, İ, ç, ö, ü karakterleri çıktıda doğru görünür

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
