// Paralel korpus temizliği (saf mantık — ağ/CDN gerektirmez, Node ile test edilir).
// SMT kalitesi eğitim verisinin temizliğine ÇOK duyarlıdır: tekrar eden cümleler
// modeli kalıp ifadelere doğru çarpıtır, çevrilmemiş/yanlış-hizalı çiftler gürültü
// öğretir. Bu modül mt-fetch-corpus.js'in tek temizlik otoritesidir.

const HTML_RE = /<[^>]+>/;                 // <i>, <br> gibi altyazı/markup artığı
const LETTER_RE = /[a-zçğıöşü]/i;          // en az bir harf (salt sayı/noktalama değil)

// Bir cümle çiftini normalize edip kalite kontrolünden geçirir.
// Kabul edilirse temizlenmiş [en, tr] döner; elenirse null.
// opts: { maxLen=500, minLen=2, minRatio=0.3, maxRatio=3.5 }
export function cleanPair(enRaw, trRaw, opts = {}) {
  const maxLen = opts.maxLen ?? 500;
  const minLen = opts.minLen ?? 2;
  const minRatio = opts.minRatio ?? 0.3;
  const maxRatio = opts.maxRatio ?? 3.5;

  // İngilizce ön-tokenizasyon düzeltmesi: bazı korpuslar (ör. OPUS Tatoeba)
  // olumsuzluk kasılmasını ayırır ("could n't"). Doğal metin/motor tokenizasyonu
  // "couldn't" bekler; bu uyumsuzluk eğitimde olumsuzluğun kaybolmasına yol açar
  // ("do n't" -> ["do","n't"] vs "don't" -> ["don","'","t"]). Doğal metinde
  // " n't" (boşluklu) görülmez, bu yüzden düzeltme güvenlidir.
  const en = String(enRaw ?? "").replace(/\s+/g, " ").trim().replace(/ n't\b/g, "n't");
  const tr = String(trRaw ?? "").replace(/\s+/g, " ").trim();

  if (!en || !tr) return null;                          // boş taraf
  if (en.length > maxLen || tr.length > maxLen) return null;   // aşırı uzun
  if (en.length < minLen || tr.length < minLen) return null;   // tek-karakter gürültü
  if (en === tr) return null;                           // çevrilmemiş (hizalama hatası)
  if (HTML_RE.test(en) || HTML_RE.test(tr)) return null;       // markup artığı
  if (!LETTER_RE.test(en) || !LETTER_RE.test(tr)) return null; // salt sayı/sembol satırı

  // Karakter uzunluğu oranı (dengesiz çift = büyük olasılıkla yanlış hizalı)
  const charRatio = en.length / Math.max(1, tr.length);
  if (charRatio < minRatio || charRatio > maxRatio) return null;

  // Kelime sayısı oranı (karakter oranının kaçırdığı dengesizlikleri yakalar)
  const enTok = en.split(" ").length, trTok = tr.split(" ").length;
  const tokRatio = enTok / Math.max(1, trTok);
  if (tokRatio < minRatio || tokRatio > maxRatio) return null;

  return [en, tr];
}

// Tekilleştirici: aynı (en,tr) çiftini ikinci kez görünce false döner.
// OPUS (özellikle OpenSubtitles) yoğun tekrar içerir; tekrarlar modeli ve
// belleği şişirir. Bellek için anahtar normalize edilmiş çiftin kendisidir.
export function makeDedup() {
  const seen = new Set();
  return (en, tr) => {
    const key = en + "\t" + tr;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}
