// ============================================================================
//  Hafif Türkçe morfoloji (stemming) — sözlüksüz, kural-tabanlı.
//  Amaç: sondan eklemeli Türkçede "kitap/kitabı/kitaba/kitaplar" gibi çekimli
//  biçimleri ortak köke indirip kelime hizalamasındaki veri kıtlığını azaltmak.
//
//  UYARI: Sözlük olmadan kök-sonu sesli harfini ekten ayırmak %100 doğru
//  yapılamaz (örn. "araba" -> "arab" yanlış olur). Bu yüzden stemming yalnızca
//  HİZALAMA için (opt-in) kullanılır; öbekler her zaman yüzey biçimden çıkarılır.
//  Böylece olası aşırı-soyma çıktı kalitesini bozmaz.
// ============================================================================

// Çekim ekleri (uzundan kısaya). Çoğul, hâl, iyelik ekleri.
const SUFFIXES = [
  "larımızdan", "lerimizden", "larınızdan", "lerinizden",
  "larından", "lerinden", "larımız", "lerimiz", "larınız", "leriniz",
  "ların", "lerin", "ları", "leri", "lar", "ler",
  "dan", "den", "tan", "ten",
  "nın", "nin", "nun", "nün",
  "mız", "miz", "muz", "müz", "nız", "niz", "nuz", "nüz",
  "ım", "im", "um", "üm", "ın", "in", "un", "ün",
  "da", "de", "ta", "te", "ya", "ye", "na", "ne",
  "ı", "i", "u", "ü", "a", "e",
];

function stripOne(w) {
  for (const suf of SUFFIXES) {
    // kök en az 4 harf kalsın (aşırı-soymayı azaltır: "kediler"->"kedi" korunur)
    if (w.length - suf.length >= 4 && w.endsWith(suf)) {
      return w.slice(0, w.length - suf.length);
    }
  }
  return null;
}

/**
 * Bir Türkçe kelimeyi (yaklaşık) köküne indirir.
 * En fazla 2 ek katmanı soyar; son yumuşak ünsüzü sertleştirir
 * (b→p, c→ç, d→t, ğ→k) — "kitabı"→"kitap" gibi.
 */
export function stemTr(word) {
  let w = word.toLocaleLowerCase("tr");
  // En fazla 2 ek katmanı soy (derinlik artınca hatalar birikir: kediler->ket)
  for (let k = 0; k < 2; k++) {
    const s = stripOne(w);
    if (!s || s.length < 4) break;
    w = s;
  }
  w = w.replace(/b$/, "p").replace(/c$/, "ç").replace(/d$/, "t").replace(/ğ$/, "k");
  return w;
}

// Bir token dizisini köklerine indirir (hizalama için).
export function stemTokens(tokens) {
  return tokens.map((t) => (/^[.,!?;:]$/.test(t) ? t : stemTr(t)));
}
