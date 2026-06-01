# 📄 PDF Çeviri

PDF dosyalarını **tamamen Türkçe'ye** çeviren bir web uygulaması. Dosyayı
sürükle-bırak ile yükleyin; uygulama metni çıkarır, **Claude API** ile
Türkçe'ye çevirir ve **Türkçe karakter destekli** (DejaVu Sans gömülü) yeni
bir PDF üretir.

- 🌍 Kaynak dil otomatik algılanır → her dilden Türkçe'ye
- 🧠 Bağlam farkındalıklı, eksiksiz çeviri (özetlemez, atlamaz)
- 📑 Sayfa sayfa ilerleme göstergesi
- 🔤 ğ, ş, ı, İ, ç, ö, ü karakterleri çıktıda doğru görünür

## Kurulum

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
