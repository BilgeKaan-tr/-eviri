# 🛠️ Kurulum — Sıfırdan, Adım Adım (Yeni Başlayanlar İçin)

Amaç: Bilgisayarınızda ücretsiz büyük bir EN-TR korpus indirip **kendi çeviri
modelinizi** eğitmek, sonra `cevir-kendi.html` ile PDF çevirmek.

> İyi haber: Bu yol için **`npm install` GEREKMEZ** — sadece **Node.js** ve proje
> dosyaları yeterli. (Motor hiçbir dış pakete bağlı değil.)

---

## ADIM 1 — Node.js kur (bir kez)

**Windows / Mac:**
1. https://nodejs.org adresine gidin.
2. Büyük yeşil **"LTS"** butonuna tıklayıp indirin (ör. "22.x.x LTS").
3. İnen dosyayı çift tıklayıp **İleri → İleri → Kur** deyin (varsayılan ayarlar).

**Linux (Ubuntu/Debian):**
```bash
sudo apt update && sudo apt install -y nodejs npm
```

**Kurulduğunu doğrulayın** (Terminal/PowerShell açıp — ADIM 3'e bakın):
```bash
node --version
```
`v22...` gibi bir yazı çıkmalı.

---

## ADIM 2 — Projeyi bilgisayara indir

**En kolay yol (Git bilmeden):**
1. GitHub'da depo sayfasını açın.
2. Yeşil **"Code"** butonuna → **"Download ZIP"**.
3. İnen ZIP'i bir klasöre **çıkartın** (ör. Masaüstü\pdf-ceviri).

**Git biliyorsanız:**
```bash
git clone https://github.com/bilgekaan-tr/-eviri.git
```

---

## ADIM 3 — O klasörde Terminal/Komut satırı aç

**Windows:**
- Çıkarttığınız klasörü Dosya Gezgini'nde açın.
- Adres çubuğuna (üstteki yol kutusu) `cmd` yazıp **Enter**. Siyah pencere açılır.
- *(veya klasöre Shift+Sağ tık → "PowerShell penceresi aç")*

**Mac:**
- **Terminal** uygulamasını açın (Spotlight: ⌘+Boşluk → "Terminal").
- `cd ` yazın (bir boşluk bırakın), klasörü Terminal'e **sürükleyip bırakın**, Enter.

**Linux:**
- Klasörde sağ tık → **"Open in Terminal"**.

Doğru yerde olduğunuzu kontrol edin:
```bash
node scripts/mt-translate.js --model data/ornek-paralel.tsv --text "merhaba"
```
(hata vermeden çalışırsa doğru klasördesiniz; bu sadece test)

---

## ADIM 4 — TEK KOMUTLA model eğit 🎉

```bash
npm run model
```
Bu komut otomatik olarak: **korpus indirir → eğitir → kaliteyi (BLEU) yazar**.
Bittiğinde klasörde **`model.json.gz`** dosyası oluşur. (İnternet gerekir;
ilk denemede `ted` korpusu kullanılır, birkaç dakika sürebilir.)

`npm` çalışmazsa komutları tek tek de verebilirsiniz:
```bash
node scripts/mt-fetch-corpus.js --corpus ted --out korpus.tsv
node scripts/mt-train-parallel.js --tsv korpus.tsv --out model.json --workers 4 --stem --gzip
node scripts/mt-eval.js --model model.json.gz --dev data/dev-ornek.tsv
```

**Daha yüksek kalite** (daha büyük korpus, daha uzun sürer):
```bash
node scripts/mt-fetch-corpus.js --corpus opensubtitles --out korpus.tsv --limit 800000
node scripts/mt-train-parallel.js --tsv korpus.tsv --out model.json --workers 4 --stem --gzip
```

---

## ADIM 5 — PDF çevir

1. `cevir-kendi.html` dosyasını çift tıklayıp tarayıcıda açın
   (`font-data.js` ile **aynı klasörde** olmalı — projede zaten var).
2. **"model.json Yükle"** → ADIM 4'te oluşan **`model.json.gz`** dosyasını seçin.
3. PDF'inizi sürükleyin → **"Çevrilmiş PDF'i İndir"**.

---

## Takılırsanız
- **"node tanınmıyor / not recognized":** Node.js kurulmamış veya terminali
  kapatıp yeniden açmadınız. ADIM 1'i tekrar yapın, terminali kapatıp açın.
- **"Cannot find module":** Yanlış klasördesiniz. ADIM 3'teki testle doğrulayın.
- **İndirme hatası:** İnternet/güvenlik duvarı engelliyor olabilir; `--corpus tatoeba`
  (küçük) ile deneyin.
- **Çeviri hâlâ zayıfsa:** Daha büyük korpus (`opensubtitles`) kullanın; veri =
  kalite. En yüksek kalite + sıfır uğraş isterseniz `cevir.html` (NLLB).
