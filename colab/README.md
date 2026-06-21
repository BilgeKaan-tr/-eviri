# Ücretsiz GPU ile Kitap Çevirisi (Google Colab)

Çeviriyi **Google'ın ücretsiz GPU'sunda** yapar — senin cihazın (tablet/telefon/bilgisayar)
sadece başlatır. 600 sayfalık kitap genelde **birkaç dakika** sürer, **ücretsizdir**,
kalite yüksektir.

## Neden bu, `cevir.html`'den farklı?
`cevir.html` çeviriyi **senin cihazında** yapar; tablet zayıf olduğu için bir kitap
saatler/günler sürebilir. Bu defter ise çeviriyi **uzaktaki güçlü bir GPU'da** yapar —
tabletin gücü artık önemli değil.

## Nasıl açılır (tabletten de olur)
1. Bir Google hesabıyla giriş yap.
2. Şu adresi aç (tek tık):
   `https://colab.research.google.com/github/bilgekaan-tr/-eviri/blob/claude/lucid-clarke-zeqkuq/colab/Kitap_Ceviri_Colab.ipynb`
3. Üstte **Çalışma zamanı → Çalışma zamanı türünü değiştir → GPU** seç, kaydet.
4. Hücreleri **yukarıdan aşağıya sırayla** ▶ ile çalıştır. 2. hücrede PDF yükle,
   son hücrede çevrilmiş PDF iner.

## Model seçimi (4. hücre)
- **Varsayılan — en iyi kalite:** `facebook/nllb-200-distilled-1.3B` (kişisel kullanım).
- **Ticari dağıtım** yapacaksan: `facebook/m2m100_1.2B` (MIT lisansı, lisans derdi yok).

## Hız/kalite ayarı (6. hücre)
- `NUM_BEAMS = 2` → hız. `4` yaparsan kalite artar, biraz yavaşlar.
- `BATCH = 16` → GPU belleği taşarsa `8` yap.

## Notlar
- Google Colab ücretsiz katmanı **kişisel kullanım** içindir; başkalarına ücretli
  hizmet vermek (ticari) için uygun değildir. Kendi kitaplarını çevirmek için idealdir.
- NLLB modeli ticari-değil (CC-BY-NC); **kendi kitabını** çevirmek kişisel kullanımdır,
  sorun olmaz. Ürünleştirip dağıtacaksan M2M-100'e (MIT) geç.
