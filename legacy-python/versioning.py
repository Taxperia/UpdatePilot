# -*- coding: utf-8 -*-
"""Sürüm dizelerini ayrıştırma ve karşılaştırma.

"1.2.3", "v2.10.0-beta", "2024.01.15", "7.0" gibi yaygın biçimleri
anlar; sayısal bölümleri sayısal, harf bölümlerini sözcük olarak
karşılaştırır. Ön sürümler (alpha/beta/rc/...) karşılık gelen
sabit sürümden küçük sayılır: 1.2.0-beta < 1.2.0.
"""
import re

# Ön sürüm sözcüklerinin sıralama rütbesi (küçük = daha eski)
_PRE_RANK = {
    "dev": -5, "alpha": -4, "a": -4, "beta": -3, "b": -3,
    "pre": -2, "preview": -2, "nightly": -2, "canary": -2, "rc": -1,
}

_TOKEN_RE = re.compile(r"\d+|[A-Za-z]+")


def clean(s):
    """Baştaki 'v' harfini ve boşlukları temizler ('v1.2.3' -> '1.2.3')."""
    s = str(s or "").strip()
    if re.match(r"^[vV]\s*\d", s):
        s = re.sub(r"^[vV]\s*", "", s)
    return s.strip()


def parse(s):
    """Sürümü karşılaştırılabilir token listesine çevirir.

    Örn: "v1.2.0-beta2" -> [1, 2, 0, 'beta', 2]
    """
    s = clean(s)
    s = s.replace("_", ".").replace("-", ".").replace("+", ".")
    tokens = []
    for part in (p for p in s.split(".") if p):
        for m in _TOKEN_RE.findall(part):
            tokens.append(int(m) if m.isdigit() else m.lower())
    return tokens


def _key(tok):
    """Tek bir token için sıralama anahtarı. Tüm anahtarlar aynı
    biçimde (rütbe, sayı, metin) olduğundan birbirleriyle
    karşılaştırılabilir."""
    if isinstance(tok, int):
        return (2, tok, "")
    rank = _PRE_RANK.get(tok)
    if rank is not None:
        return (0, rank, tok)
    return (1, 0, tok)


def sort_key(s):
    """Sürüm dizelerini liste içinde sıralamak için anahtar.

    Sondaki (1, 0, "") terimi "sabit sürüm" sonlandırıcısıdır:
    1.2.0-beta < 1.2.0 < 1.10 sıralamasını compare() ile aynı yapar.
    """
    return tuple(_key(t) for t in parse(s)) + ((1, 0, ""),)


def compare(a, b):
    """a<b ise -1, a==b ise 0, a>b ise 1 döner."""
    if clean(a) == clean(b):
        return 0
    ta, tb = parse(a), parse(b)
    pad = (1, 0, "")  # eksik bölüm: ön sürüm sözcüklerinden büyük, sayıdan küçük
    for i in range(max(len(ta), len(tb))):
        ka = _key(ta[i]) if i < len(ta) else pad
        kb = _key(tb[i]) if i < len(tb) else pad
        if ka < kb:
            return -1
        if ka > kb:
            return 1
    return 0


def is_newer(latest, current):
    """latest sürümü, kurulu current sürümünden daha yeni mi?"""
    if not clean(latest) or not clean(current):
        return False
    return compare(latest, current) > 0


def is_prerelease(tag):
    """Etiket bir ön sürüm mü? (alpha, beta, rc, nightly...)"""
    t = clean(tag).lower()
    return any(w in t for w in ("alpha", "beta", "rc", "dev", "preview", "nightly", "canary", "pre"))
