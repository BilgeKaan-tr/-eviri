// ============================================================================
//  Türkçe morfolojik segmentasyon + üretim (opt-in)
//
//  SORUN: Türkçe sondan eklemeli. "ev, evi, eve, evler, evlerin, evlerinde..."
//  yüzey biçimleri patlar. Yüzey-biçim öbek çıkarımı yalnızca eğitimde GÖRÜLEN
//  ek-kombinasyonlarını üretebilir; görülmemiş çekimi üretemez.
//
//  ÇÖZÜM (segment=true): Türkçe tarafı eğitimde yüzey yerine
//      kök + soyut ek-etiketleri  dizisine ayrılır:
//        "evlerinde" -> ["ev", "+LER", "+POSS", "+LOC"]
//  Çeviri çıktısı bu soyut etiketleri içerir; glueTr ile ÜNLÜ UYUMU ve
//  ünsüz yumuşaması uygulanarak tekrar yüzey biçime birleştirilir:
//        ["ev", "+LER", "+LOC"] -> "evlerde"
//
//  Bu, "kalite tavanını" kıran asıl mekanizmadır: model ekleri bağımsız
//  birimler olarak öğrenir, üretimde doğru biçimi sentezler. Sözlüksüz ve
//  kural-tabanlı olduğundan %100 doğru değildir; bu yüzden VARSAYILAN KAPALI
//  ve mevcut yüzey-biçim modellerini bozmaz.
//
//  Desteklenen soyut ekler (yaygın çekim ekleri):
//    +LER (çoğul) | +POSS (3.tekil iyelik) | +ACC (belirtme) | +DAT (yönelme)
//    +LOC (bulunma) | +ABL (ayrılma) | +GEN (tamlayan)
// ============================================================================

const BACK = new Set(["a", "ı", "o", "u"]);   // kalın ünlüler
const FRONT = new Set(["e", "i", "ö", "ü"]);  // ince ünlüler
const ROUND = new Set(["o", "u", "ö", "ü"]);  // yuvarlak ünlüler
const VOWELS = new Set([...BACK, ...FRONT]);

function lastVowel(w) {
  for (let i = w.length - 1; i >= 0; i--) if (VOWELS.has(w[i])) return w[i];
  return null;
}
function endsWithVowel(w) { return VOWELS.has(w[w.length - 1]); }

// 2'li (a/e) ünlü uyumu: son ünlü kalınsa "a", inceyse "e".
function lowVowel(w) { const v = lastVowel(w); return v && BACK.has(v) ? "a" : "e"; }
// 4'lü (ı/i/u/ü) ünlü uyumu.
function highVowel(w) {
  const v = lastVowel(w);
  if (!v) return "i";
  if (BACK.has(v)) return ROUND.has(v) ? "u" : "ı";
  return ROUND.has(v) ? "ü" : "i";
}

// Son sert ünsüz yumuşaması (p→b, ç→c, t→d, k→ğ) — ünlüyle başlayan ek gelince.
function soften(stem) {
  const last = stem[stem.length - 1];
  const map = { p: "b", ç: "c", t: "d", k: "ğ" };
  if (map[last]) return stem.slice(0, -1) + map[last];
  return stem;
}

// ---- ÜRETİM: bir kök + soyut ek dizisini yüzey biçime birleştirir ----
// Sıralama Türkçe ek dizilişini izler: kök (+LER) (+POSS) (hâl).
// tokens: ["ev","+LER","+LOC"] -> "evlerde"
export function glueOne(stem, suffixes) {
  let w = stem;
  // Pronominal kaynaştırma -n-: 3.tekil iyelikten (+POSS) SONRA gelen hâl ekleri
  // araya -n- alır: "evi" + LOC -> "evinde" (evide DEĞİL), "evi" + DAT -> "evine".
  // afterPoss, bir önceki ekin +POSS olup olmadığını izler.
  let afterPoss = false;
  for (const suf of suffixes) {
    const vowelStart = w; // uyum, mevcut yüzeye göre
    switch (suf) {
      case "+LER": // çoğul: -lar/-ler
        w += "l" + lowVowel(vowelStart) + "r";
        afterPoss = false;
        break;
      case "+POSS": { // 3.tekil iyelik: -ı/-i/-u/-ü, ünlüden sonra -sı/-si
        w = endsWithVowel(w) ? w + "s" + highVowel(vowelStart) : soften(w) + highVowel(vowelStart);
        afterPoss = true;
        break;
      }
      case "+ACC": { // belirtme hâli: -ı/-i/-u/-ü, ünlüden sonra -yı/-yi
        if (afterPoss) w += "n" + highVowel(vowelStart);          // evi -> evini
        else w = endsWithVowel(w) ? w + "y" + highVowel(vowelStart) : soften(w) + highVowel(vowelStart);
        afterPoss = false;
        break;
      }
      case "+DAT": // yönelme: -a/-e, ünlüden sonra -ya/-ye
        if (afterPoss) w += "n" + lowVowel(vowelStart);           // evi -> evine
        else w = endsWithVowel(w) ? w + "y" + lowVowel(vowelStart) : soften(w) + lowVowel(vowelStart);
        afterPoss = false;
        break;
      case "+LOC": { // bulunma: -da/-de/-ta/-te (ünsüz sertleşmesi)
        if (afterPoss) { w += "n" + "d" + lowVowel(vowelStart); }  // evi -> evinde
        else { const d = "pçtkfshş".includes(w[w.length - 1]) ? "t" : "d"; w += d + lowVowel(vowelStart); }
        afterPoss = false;
        break;
      }
      case "+ABL": { // ayrılma: -dan/-den/-tan/-ten
        if (afterPoss) { w += "n" + "d" + lowVowel(vowelStart) + "n"; } // evi -> evinden
        else { const d = "pçtkfshş".includes(w[w.length - 1]) ? "t" : "d"; w += d + lowVowel(vowelStart) + "n"; }
        afterPoss = false;
        break;
      }
      case "+GEN": // tamlayan: -ın/-in/-un/-ün, ünlüden sonra -nın/-nin
        if (afterPoss) w += "n" + highVowel(vowelStart) + "n";    // evi -> evinin
        else w = endsWithVowel(w) ? w + "n" + highVowel(vowelStart) + "n" : soften(w) + highVowel(vowelStart) + "n";
        afterPoss = false;
        break;
      default:
        w += suf; // bilinmeyen etiket: olduğu gibi
        afterPoss = false;
    }
  }
  return w;
}

// ---- SEGMENTASYON: yüzey biçimi kök + soyut ek dizisine ayırır ----
// Sözlüksüz, en-uzun-ek-önce greedy soyma. Tanınmayan kuyruk kökte kalır.
// Geri-üretilebilirlik için yalnızca GÜVENLİ ekler ayrılır (kök >= 2 harf).
const SUFFIX_RULES = [
  // [regex (sonek), etiket | [etiketler], minimum kalan kök uzunluğu]
  // 3.tekil iyelik + hâl (pronominal -n-): "evinde, arabasına, evinden". En dıştaki
  // BİRLEŞİK ek; düz hâl eklerinden ÖNCE denenir. Yanlış eşleşmeler (örn. "günde",
  // "içinde") round-trip doğrulamasıyla güvenle yüzey biçime düşer. Etiket dizisi
  // kök→dış sırada uygulanır: [+POSS, +CASE].
  [/(?:sında|sinde|sunda|sünde)$/, ["+POSS", "+LOC"], 2],   // arabasında
  [/(?:ında|inde|unda|ünde)$/, ["+POSS", "+LOC"], 2],        // evinde, yüzünde
  [/(?:sından|sinden|sundan|sünden)$/, ["+POSS", "+ABL"], 2],// arabasından
  [/(?:ından|inden|undan|ünden)$/, ["+POSS", "+ABL"], 2],    // evinden
  [/(?:sına|sine|suna|süne)$/, ["+POSS", "+DAT"], 2],         // arabasına
  [/(?:ına|ine|una|üne)$/, ["+POSS", "+DAT"], 2],             // evine
  [/(?:sının|sinin|sunun|sünün)$/, ["+POSS", "+GEN"], 2],     // arabasının (GEN, ACC'ten önce: daha uzun)
  [/(?:ının|inin|unun|ünün)$/, ["+POSS", "+GEN"], 2],         // evinin
  [/(?:sını|sini|sunu|sünü)$/, ["+POSS", "+ACC"], 2],         // arabasını
  [/(?:ını|ini|unu|ünü)$/, ["+POSS", "+ACC"], 2],             // evini
  // hâl ekleri (en dışta) — önce bunları soy
  [/(?:nde|nda)$/, "+LOC", 3, true],   // iyelikli bulunma: evinde (POSS gerektirir; kabaca)
  [/(?:den|dan|ten|tan)$/, "+ABL", 3],
  [/(?:de|da|te|ta)$/, "+LOC", 3],
  [/(?:yi|yı|yu|yü)$/, "+ACC", 3],
  [/(?:ı|i|u|ü)$/, "+ACC", 3],          // belirtme (POSS ile karışabilir; ACC seçilir)
  [/(?:ya|ye)$/, "+DAT", 3],
  [/(?:a|e)$/, "+DAT", 3],
  [/(?:nın|nin|nun|nün)$/, "+GEN", 3],
  [/(?:ın|in|un|ün)$/, "+GEN", 3],
  // çoğul (en içte, kökten hemen sonra)
  [/ler$/, "+LER", 3],
  [/lar$/, "+LER", 3],
];

export function segmentWord(word) {
  let w = word;
  // Her soyma katmanından sonraki (stem, suffixes) durumunu kaydet.
  // 0. durum (ayrışma yok) daima geçerli — güvenli yedek.
  const states = [{ stem: word, suffixes: [] }];
  const suffixes = [];
  for (let layer = 0; layer < 3; layer++) {
    let matched = false;
    for (const [re, tag, minLen] of SUFFIX_RULES) {
      const m = w.match(re);
      if (m && w.length - m[0].length >= minLen) {
        // tag dizi olabilir ([+POSS,+LOC] gibi birleşik ek); kök→dış sırasını
        // koruyarak başa ekle (dıştan içe soyduğumuz için).
        const tags = Array.isArray(tag) ? tag : [tag];
        suffixes.unshift(...tags);
        w = w.slice(0, w.length - m[0].length);
        states.push({ stem: w, suffixes: suffixes.slice() });
        matched = true;
        break;
      }
    }
    if (!matched) break;
  }
  // ROUND-TRIP GÜVENCESİ: en derinden sığa doğru, glueOne ile orijinali BİREBİR
  // geri verebilen ilk ayrışmayı seç. Böylece segmentTokens→glueTokens daima
  // yüzey biçimi kayıpsız geri kurar; hatalı analiz çıktıyı asla bozmaz
  // (örn. "kapıyı" yanlışlıkla "kab..."e dönüşmez, güvenli katmana düşülür).
  for (let k = states.length - 1; k >= 1; k--) {
    if (glueOne(states[k].stem, states[k].suffixes) === word) return states[k];
  }
  return states[0];
}

// Bir Türkçe token dizisini segment token dizisine çevirir (eğitim için).
// Noktalama/sayı/ASCII (URL vb.) dokunulmaz. Kök ve her ek ayrı token olur.
export function segmentTokens(tokens) {
  const out = [];
  for (const tk of tokens) {
    if (!/[a-zçğıöşü]/i.test(tk) || /\d/.test(tk) || tk.length < 4) { out.push(tk); continue; }
    const { stem, suffixes } = segmentWord(tk);
    if (!suffixes.length) { out.push(tk); continue; }
    out.push(stem, ...suffixes);
  }
  return out;
}

// Çeviri çıktısındaki kök+ek token dizisini yüzey biçime birleştirir.
// Ardışık ek etiketlerini (+XXX) önceki köke yapıştırır.
export function glueTokens(tokens) {
  // Her kökü, onu izleyen TÜM ek etiketleriyle TEK glueOne çağrısında birleştir.
  // (Ekleri tek tek uygulamak, +POSS sonrası pronominal -n- gibi eklerarası
  // bağlamı kaybeder: "evi"+LOC tek başına "evide" üretirdi.)
  const out = [];
  let stem = null, suf = [];
  const flush = () => { if (stem !== null) { out.push(glueOne(stem, suf)); stem = null; suf = []; } };
  for (const tk of tokens) {
    if (/^\+[A-Z]+$/.test(tk)) {
      if (stem !== null) suf.push(tk); // baştaki başıboş ek (kök yok): yok say
    } else {
      flush();
      stem = tk;
    }
  }
  flush();
  return out;
}
