# 📘 Kullanım Kılavuzu — PDF Çeviri

Bu depo, PDF'leri Türkçe'ye çeviren birkaç araç içerir. **Hangisini kullanmalıyım?**

| İhtiyacınız | Kullanın | Ücret/Bağımlılık |
|---|---|---|
| Kendi motorumu kitaplarımla **eğitmek** ve çevirmek | **`egit.html`** | Yok (tamamen tarayıcıda) |
| Eğittiğim `model.json` ile sadece **çevirmek** | **`cevir-kendi.html`** | Yok |
| Hazır, **yüksek kaliteli** çeviri (telefonda da) | **`cevir.html`** (Meta NLLB) | Bir kez ~300-600 MB model iner |
| **En yüksek** kalite | Node sunucu (Claude API) | Anthropic kredisi (ücretli) |

> Soru: "İngilizce ve Türkçe kitap atmam yeterli mi?" — **Evet.** İki düz `.txt`
> dosyası (biri İngilizce kitap, biri onun Türkçe çevirisi) yükleyin; sistem
> cümleleri otomatik hizalayıp eğitir. Ne kadar çok kitap, o kadar iyi.

---

## 🚀 Ana yol: Kendi motorunuzu eğitin — `egit.html`

### 1. Hazırlık
- `egit.html` ve `font-data.js` **aynı klasörde** olsun.
- (Geliştiriciyseniz `npm run build:web` ile `egit.html` üretilir.)
- Kitaplarınızı **düz metin (.txt)** olarak hazırlayın:
  - `kitap1-en.txt` → İngilizce metin
  - `kitap1-tr.txt` → aynı kitabın Türkçe çevirisi
  - (PDF/epub iseniz önce .txt'ye dönüştürün.)

### 2. Aç ve yükle
`egit.html`'i çift tıklayıp tarayıcıda açın. **"1) Modeli eğit"** bölümünde:
- **TSV dosyaları:** Elinizde hizalı `kaynak⇥türkçe` satırları varsa (sekmeyle
  ayrılmış). Birden çok seçebilirsiniz.
- **veya EN kitaplar / TR kitaplar:** Ham `.txt` kitapları seçin. Birden çok
  seçebilirsiniz; **sırayla eşleşirler** (1. EN ↔ 1. TR, 2. EN ↔ 2. TR …).

### 3. Eğit
**"Eğit"**e basın. Eğitim, bilgisayarınızın **tüm çekirdeklerini** kullanarak
arka planda yapılır; ilerleme çubuğu yüzdeyi gösterir. Bittiğinde
"✓ model hazır" yazısı belirir.

Ayarlar (isteğe bağlı):
- **EM turu:** Hizalama tur sayısı (varsayılan 15). Daha fazla = biraz daha iyi
  hizalama, daha yavaş.
- **maks. öbek:** En uzun kelime grubu (varsayılan 4).
- **çekirdek:** 0 = otomatik (cihazınızdaki çekirdek sayısı).
- **Türkçe stem:** Çekim eklerini hizalamada birleştirir; **büyük veride açın**.

### 4. (İsteğe bağlı) Kalite ve sözlük — "2) Kalite ölçümü"
- **dev TSV:** Birkaç yüz `kaynak⇥referans` satırı → **"BLEU hesapla"** ile
  kaliteyi ölçün (yüksek = iyi).
- **"Otomatik ayarla":** Ağırlıkları BLEU'ya göre optimize eder ve modele işler.
- **Sözlük TSV:** Kendi `kelime⇥karşılık` sözlüğünüz; bilinmeyen kelimelerde
  kullanılır (örn. teknik terimler).

### 5. Çevir — "3) PDF çevir"
PDF'i sürükleyin. Çeviri bitince **"Çevrilmiş PDF'i İndir"**. Başlıklar daha
büyük, paragraflar korunarak yazılır.

### 6. Modeli sakla
**"modeli indir (.gz)"** ile eğittiğiniz modeli kaydedin. Bir daha eğitmeden,
`cevir-kendi.html`'de bu dosyayı yükleyip doğrudan çevirebilirsiniz.

---

## 📄 Sadece çevir — `cevir-kendi.html`
Eğittiğiniz `model.json` (veya `.gz`) ile PDF çevirir. Aç → **model.json Yükle**
→ PDF sürükle → indir. Hızlıdır, eğitim gerektirmez.

---

## 🌍 Hazır kaliteli çeviri — `cevir.html`
Eğitim/kitap gerektirmez. Meta **NLLB-200** modelini ilk açılışta bir kez indirir
(~300-600 MB), sonra **çevrimdışı** çalışır. Telefon/tablet için de uygundur.
Aç → **"Modeli İndir ve Hazırla"** → PDF sürükle.

---

## ⌨️ İleri kullanım (Node CLI)

```bash
# 1) Ham iki kitabı otomatik hizala (isteğe bağlı; egit.html bunu kendi yapar)
node scripts/mt-align.js --src kitap-en.txt --tgt kitap-tr.txt --out cift.tsv

# 2) Eğit (öbek-tabanlı, önerilen). Büyük veride: --stem --mincount 2
node scripts/mt-train.js --tsv cift.tsv --out model.json --iter 20 --stem

#    Çok çekirdekli:
node scripts/mt-train-parallel.js --tsv cift.tsv --out model.json --workers 8 --stem

#    Çok büyük dosya (bellek dostu, akışlı):
node scripts/mt-train-stream.js --tsv buyuk.tsv --out model.json --batch 20000 --gzip

# 3) Parça parça eğitilen modelleri birleştir
node scripts/mt-merge.js --out birlesik.json m1.json m2.json m3.json

# 4) Sözlük ekle / sıkıştır
node scripts/mt-train.js --tsv cift.tsv --out model.json --dict sozluk.tsv --gzip

# 5) Kaliteyi ölç ve ağırlıkları ayarla
node scripts/mt-tune.js --model model.json --dev dev.tsv --save

# 6) Çevir (metin)
node scripts/mt-translate.js --model model.json --text "the old red car"
```

**Dosya biçimleri**
- **TSV:** her satır `kaynak metin <TAB> türkçe metin`
- **Sözlük TSV:** `kelime <TAB> karşılık`
- **dev TSV:** `kaynak <TAB> referans türkçe` (kalite ölçümü için)

---

## ❓ Sık sorulanlar

**Tek kitap yeter mi?** Çalışır ama kelime dağarcığı dar olur. En az birkaç,
ideal olarak binlerce kitap çifti önerilir.

**Kitaplar hangi dilde?** Varsayılan kaynak İngilizce → hedef Türkçe. Kaynak
dili değiştirmek için CLI'de `--lang` kullanın.

**Çeviri Claude/Google kadar iyi mi?** Hayır — istatistiksel motorun tavanı
sinir ağlarının biraz altındadır. Ama **tamamen sizindir, bağımsızdır,
çevrimdışıdır ve ücretsizdir.** Veri arttıkça belirgin şekilde iyileşir.

**Verilerim bir yere gidiyor mu?** Hayır. `egit.html` / `cevir-kendi.html` /
`cevir.html` tamamen cihazınızda çalışır.

**Taranmış (resim) PDF?** Önce OCR ile metne çevirmeniz gerekir; bu araçlar
metin tabanlı PDF bekler.
