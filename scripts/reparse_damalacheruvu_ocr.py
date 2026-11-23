#!/usr/bin/env python3
"""Re-parse Damalacheruvu OCR cache → cleaner voters.json / voters_latest.json.

Does not re-run Tesseract. Fixes EPIC digit garble (143####### → IAX…),
improves name/age/house/gender extraction, renames photo files when EPIC changes.
"""

from __future__ import annotations

import json
import re
import shutil
from collections import Counter
from pathlib import Path

from extract_damalacheruvu_ocr import (
    APP_NAME,
    ASSEMBLY,
    DISTRICT,
    MANDAL,
    PANCHAYAT,
    YEAR,
    age_band,
    build_voter,
    clean_spaces,
    to_english,
)

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "ocr_cache" / "raw_rows.json"
OUT = ROOT / "web" / "public" / "data" / "voters.json"
LATEST = ROOT / "web" / "public" / "data" / "voters_latest.json"
PHOTO_DIR = ROOT / "web" / "public" / "photos"

# OCR often reads IAX as 143… and BDG as 806…
DIGIT_PREFIX = {
    "143": "IAX",
    "140": "IAX",
    "146": "IAX",
    "141": "IAX",
    "142": "IAX",
    "806": "BDG",
    "800": "BDG",
    "8DG": "BDG",
}

GARBAGE_LETTER_PREFIX = {
    "IXX",
    "IIX",
    "IXO",
    "IXI",
    "IOX",
    "III",
    "IIO",
    "IOO",
    "IOI",
    "IXS",
    "SXX",
    "TAN",
    "IAN",
    "IAX",  # keep IAX as-is when already letters
}


def extract_epic(text: str, fallback: str = "") -> str:
    s = (text or "").upper().replace(" ", "").replace("O", "0")
    # Prefer digit-garbled known series from OCR text
    for dig, pref in DIGIT_PREFIX.items():
        m = re.search(rf"(?<!\d){dig}(\d{{7}})(?!\d)", s)
        if m:
            return pref + m.group(1)
    m = re.search(r"\b([A-Z]{3}\d{7})\b", s)
    if m:
        epic = m.group(1)
        pre, num = epic[:3], epic[3:]
        if pre in {"IXX", "IIX", "IXO", "IXI", "IOX", "III", "IIO", "IOO", "IOI", "IAN", "TAX", "LAX", "1AX"}:
            return "IAX" + num
        if pre in {"8DG", "BOG", "BD0", "BDO"}:
            return "BDG" + num
        return epic
    # fallback from prior epic field
    fb = (fallback or "").upper()
    m = re.search(r"([A-Z]{3})(\d{7})", fb)
    if m:
        pre, num = m.group(1), m.group(2)
        if pre in {"IXX", "IIX", "IXO", "IXI", "IOX", "III", "IIO", "IOO", "IOI", "IAN", "TAX", "LAX"}:
            return "IAX" + num
        return pre + num
    return ""


def _clean_person_value(val: str) -> str:
    val = clean_spaces(val or "")
    val = re.sub(r"^[:.\s\|\-_\)\(]+", "", val)
    # Strip leading printed serial / digit bleed from previous card ("2 దిలీప్")
    val = re.sub(r"^\d{1,4}\s+", "", val)
    val = re.split(
        r"తండ్రి|తల్లి|భర్త|వయస్సు|వయసు|మనస్సు|లింగము|ఇంటి|ఏటి|ఐడి|కార్డు|నెం|"
        r"Father|Mother|Husband|Age|House",
        val,
        maxsplit=1,
    )[0]
    val = clean_spaces(re.sub(r"[|\[\]\{\}=]+", " ", val))
    val = re.sub(r"[\u200c\u200d]+", "", val)  # ZWJ/ZWNJ noise
    val = val.rstrip(".,;:،")
    # Drop Latin OCR garbage words when Telugu is present (e.g. "గుర్రంకొండ Harter")
    if re.search(r"[\u0C00-\u0C7F]", val):
        val = re.sub(r"\b[A-Za-z]{2,}\b", " ", val)
        val = re.sub(r"\s+[A-Za-z0-9=]+$", "", val)
    val = clean_spaces(val)
    # Deduplicate repeated tokens (షాజహన్ షాజహన్)
    parts = val.split()
    if len(parts) >= 2:
        dedup = [parts[0]]
        for p in parts[1:]:
            if p != dedup[-1]:
                dedup.append(p)
        val = " ".join(dedup)
    return clean_spaces(val)


def _is_plausible_person(val: str) -> bool:
    if not val or len(val) < 2:
        return False
    if re.search(r"(కార్డు|నెం|IAX|BDG|\d{6,})", val, re.I):
        return False
    if re.fullmatch(r"[:.\-\s]+", val):
        return False
    # label leftovers / header bleed — not a person name
    if re.fullmatch(r"(పేరు|తండ్రి|తల్లి|భర్త|ఓటరు|ఏరు)", val):
        return False
    if re.search(r"ననన|Nanana|NA\s*Pa|స\s*స\s*న", val, re.I):
        return False
    te = len(re.findall(r"[\u0C00-\u0C7F]", val))
    if te < 2:
        return False
    letters = re.sub(r"[^A-Za-z\u0C00-\u0C7F]", "", val)
    if len(letters) < 2:
        return False
    return True


def looks_like_garbage_name(val: str) -> bool:
    """True when cached name is clearly OCR/bleed garbage (trigger re-OCR)."""
    if not val:
        return True
    if re.match(r"^[\d\)\(:.\s“\"']+", val) and len(re.findall(r"[\u0C00-\u0C7F]", val)) < 4:
        return True
    if re.search(r"ననన|Nanana|NA\s*Pa|NA\s*SA|న\s*పా|స\s*స\s*న|^\d+\s", val, re.I):
        return True
    te = len(re.findall(r"[\u0C00-\u0C7F]", val))
    latin = len(re.findall(r"[A-Za-z]", val))
    # English transliteration of garbage, or almost no Telugu letters
    if te == 0 and (latin < 3 or re.search(r"NA\s*Pa|NA\s*SA|Nanana", val, re.I)):
        return True
    if te < 2 and latin < 3:
        return True
    # Two-letter acronym-like OCR junk
    if te == 0 and re.fullmatch(r"[A-Z]{1,3}(?:\s+[A-Z]{1,3})?", val or ""):
        return True
    return False


def _name_line_match(ln: str) -> bool:
    """True if line looks like the voter-name label row (even when value is garbage)."""
    return bool(
        re.search(
            r"ఓటరు\s*పేరు|ఓటరుపేరు|ఏరు\s*పేరు|రు\s*పేరు|ఏరు\s*boo|ఏరు\s*bo|"
            r"ఓటరు\s*(?:Dd|od|Do|bo|OO)|(?:l+o[do]\s*b[o0h]|so+o?\s*bh?|no+b)\b",
            ln,
            re.I,
        )
    )


def parse_name(text: str) -> str:
    """Extract voter name; tolerate heavy Telugu OCR mangling of ఓటరు పేరు."""
    # Truncated cards (page break) often start at relation — do not steal it as name
    lines_all = [ln.strip() for ln in text.splitlines() if ln.strip()]
    first_content = " ".join(lines_all[:3])
    if re.search(r"^(తండ్రి|తల్లి|భర్త)\s*పేరు", first_content) and not re.search(
        r"ఓటరు\s*పేరు|ఏరు\s*పేరు|రు\s*పేరు", text
    ):
        return ""

    patterns = [
        r"ఓటరు\s*పేరు\.?\s*[:.\s]*([^\n]+)",
        r"ఓటరుపేరు\.?\s*[:.\s]*([^\n]+)",
        r"ఓటరు\s*(?:Dd|od|Do|bo|OO|dd)\)?\s*[:.\s]*([^\n]+)",  # ఓటరు Dd) :
        r"ఓటరు\s*[:.\s]*([^\n]{2,40})",
        r"ఏరు\s*పేరు\.?\s*[:.\s]*([^\n]+)",
        r"రు\s*పేరు\.?\s*[:.\s]*([^\n]+)",  # truncated ఓటరు పేరు
        r"ఎ\s*పేరు\.?\s*[:.\s]*([^\n]+)",
        r"ఏరు\s*boo?\s*[:.\s]*([^\n]+)",
        r"ఏరు\s*bo\s*[:.\s]*([^\n]+)",
        r"(?i)l+o[dt]\s*(?:పేరు|b[o0h]|be)\s*[:.\s]*([^\n]+)",  # Lot పేరు / Loo be
        r"(?i)l+o[do]\s*b[o0h]\s*[:.\s]*([^\n]+)",  # Loo/Lob/Lod bo
        r"(?i)so+o?\s*bh?\s*[:.\s]*([^\n]+)",  # soo bh
        r"(?i)no+b\s*[:.\s]*([^\n]+)",  # noob :
        r"(?:^|\n)\s*at\s*[:.\s]+([^\n]{2,40})",  # OCR of ఓటరు truncated to "at :"
        r"(?i)(?:^|\n)\s*(?:bo+|bh|od|dd)\s*[:.\s]+([^\n]{2,40})",
        # bare పేరు line when it appears before age/relation (name-only crop)
        r"(?:^|\n)\s*పేరు\.?\s*[:.\s]*([^\n]{2,40})",
    ]
    for pat in patterns:
        m = re.search(pat, text)
        if not m:
            continue
        val = _clean_person_value(m.group(1))
        if val.startswith("పేరు"):
            val = _clean_person_value(val[len("పేరు") :])
        # strip trailing latin OCR crumbs (ry, ce, cor, om)
        val = re.sub(r"\s+[A-Za-z]{1,4}$", "", val).strip()
        if _is_plausible_person(val):
            # reject obvious OCR garbage names (68S, ry, etc.)
            if re.fullmatch(r"[A-Za-z0-9 .]{1,8}", val) and len(re.findall(r"[\u0C00-\u0C7F]", val)) == 0:
                continue
            # reject label leftovers like "ఏరు boo 68S"
            if re.search(r"(?i)\bboo?\b|\b68S\b", val) and len(re.findall(r"[\u0C00-\u0C7F]", val)) < 3:
                continue
            return val

    # Fallback ONLY when no name-label line exists (avoid stealing relation name).
    # If label was present but value garbled (e.g. "ఏరు boo 68S"), leave empty
    # so relation parser can take the next Telugu line.
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if any(_name_line_match(ln) for ln in lines):
        return ""
    for ln in lines:
        if re.search(r"వయస్సు|లింగము|ఇంటి|ఐడి|కార్డు", ln):
            break
        if re.search(r"తండ్రి|తల్లి|భర్త", ln):
            break
        if re.search(r"అ\.ఓ|గా\.పం|SEC|166\s*-", ln):
            continue
        te = len(re.findall(r"[\u0C00-\u0C7F]", ln))
        if te >= 3 and "పేరు" not in ln:
            if ":" in ln:
                val = _clean_person_value(ln.split(":", 1)[1])
            else:
                val = _clean_person_value(ln)
            val = re.sub(r"\s+[A-Za-z]{1,4}$", "", val).strip()
            if _is_plausible_person(val) and not re.match(r"^(వయస్|లింగ|ఇంటి)", val):
                return val
    return ""


def parse_relation(text: str, voter_gender: str = "") -> tuple[str, str]:
    patterns = [
        (r"భర్త\s*పేరు\.?\s*[:.\s]*([^\n]+)", "Husband"),
        (r"భర్తపేరు\.?\s*[:.\s]*([^\n]+)", "Husband"),
        (r"భర్త[^\n]{0,8}[:.\s]+([^\n]+)", "Husband"),  # భర్తశ్హురు / భర్తశ్లేరు
        (r"ర\s*కేరు\s*[:.\s]*([^\n]+)", "Husband"),  # OCR of భర్త పేరు
        (r"భర్త\s*[:.\s]+([^\n]+)", "Husband"),
        (r"తండ్రి\s*పేరు\.?\s*[:.\s]*([^\n]+)", "Father"),
        (r"తండ్రిపేరు\.?\s*[:.\s]*([^\n]+)", "Father"),
        (r"తండి\s*పేరు\.?\s*[:.\s]*([^\n]+)", "Father"),
        (r"తండ్రి[^\n]{0,6}[:.\s=]+([^\n]+)", "Father"),
        (r"తండ్రి\s*[:.\s]+([^\n]+)", "Father"),
        (r"తల్లి\s*పేరు\.?\s*[:.\s]*([^\n]+)", "Mother"),
        (r"తల్లిపేరు\.?\s*[:.\s]*([^\n]+)", "Mother"),
        (r"తల్లి\s*[:.\s]+([^\n]+)", "Mother"),
        # OCR mangled father/husband labels
        (r"(?i)so+[dg]\s*bo\s*[:.\s]*([^\n]+)", "Father"),
        (r"(?i)2\|\|\s*తండి\s*పేరు\.?\s*[:.\s]*([^\n]+)", "Father"),
        (r"(?i)\bBSD\b\s*[:.\s]*([^\n]+)", "Husband"),  # భర్త OCR as BSD
        # Ambiguous mangled labels — type filled from gender below
        (r"(?i)(?:^|\n)\s*(?:BD|Bb|Wd|Ad|pad|DO|sad|pac|HO|Bd|yo)\s*[:.\s]+([^\n]{2,40})", "_REL_"),
        (r"భర్త\s*(?:DO|Dd|bo)?\s*[:.\s]*([^\n]+)", "Husband"),
        # Bare "పేరు : X" / truncated "రు : X" after voter name
        (r"(?:^|\n)\s*పేరు\.?\s*[:.\s]+([^\n]{2,40})", "_REL_"),
        (r"(?:^|\n)\s*రు\s*[:.\s]+([^\n]{2,40})", "_REL_"),
        # Heavily mangled father label e.g. "1G : లేట్ కమీరన్"
        (r"(?i)(?:^|\n)\s*(?:1G|IG|TG|7G)\s*[:.\s]+([^\n]{2,40})", "Father"),
        # Unlabeled relation value alone after colon on its own line
        (r"(?:^|\n)\s*[:.\-]+\s*([అ-హ][^\n]{2,40})", "_REL_"),
    ]
    for pat, rtype in patterns:
        m = re.search(pat, text)
        if not m:
            continue
        val = _clean_person_value(m.group(1))
        val = re.sub(r"\s+[A-Za-z]{1,4}$", "", val).strip()
        # drop trailing Telugu single-char OCR crumbs
        val = re.sub(r"\s+[\u0C00-\u0C7F]$", "", val).strip()
        if _is_plausible_person(val):
            if rtype == "_REL_" or (
                "పేరు" in pat and "భర్త" not in pat and "తండ్రి" not in pat and "తల్లి" not in pat
            ):
                g = voter_gender or parse_gender(text)
                rtype = "Husband" if g == "Female" else "Father"
            return rtype, val

    # Label on one line, value on next
    lines = [ln.strip() for ln in text.splitlines()]
    for i, ln in enumerate(lines):
        rtype = ""
        if re.search(r"భర్త|కేరు|\bBSD\b|\bBD\b|\bBb\b", ln, re.I):
            rtype = "Husband"
        elif re.search(r"తండ్రి|తండి|so+[dg]\s*bo|\b(?:Wd|Ad|pad|1G|DO)\b", ln, re.I):
            rtype = "Father"
        elif re.search(r"తల్లి", ln):
            rtype = "Mother"
        if not rtype:
            continue
        if ":" in ln:
            val = _clean_person_value(ln.split(":", 1)[1])
            val = re.sub(r"\s+[A-Za-z]{1,4}$", "", val).strip()
            if _is_plausible_person(val):
                return rtype, val
        if i + 1 < len(lines):
            nxt = lines[i + 1]
            if re.search(r"వయస్సు|లింగము|ఇంటి|ఓటరు", nxt):
                continue
            val = _clean_person_value(nxt.split(":", 1)[-1] if ":" in nxt else nxt)
            val = re.sub(r"\s+[A-Za-z]{1,4}$", "", val).strip()
            if _is_plausible_person(val):
                return rtype, val

    # Unlabeled relation: after voter-name line, next Telugu name before age/house
    # (e.g. S.No 6 / S.No 14: name then relation with no తండ్రి/భర్త label)
    name_line_idx = None
    for i, ln in enumerate(lines):
        if _name_line_match(ln):
            name_line_idx = i
            break
    if name_line_idx is None:
        # Name may be a bare Telugu line (label lost) — use first plausible person line
        for i, ln in enumerate(lines):
            if re.search(r"వయస్సు|లింగము|ఇంటి|ఐడి|కార్డు", ln):
                break
            val = _clean_person_value(ln.split(":", 1)[-1] if ":" in ln else ln)
            val = re.sub(r"^\d{1,4}\s+", "", val)
            if _is_plausible_person(val) and len(re.findall(r"[\u0C00-\u0C7F]", val)) >= 3:
                name_line_idx = i
                break
    if name_line_idx is not None:
        for j in range(name_line_idx + 1, min(name_line_idx + 5, len(lines))):
            ln = lines[j]
            if re.search(r"వయస్సు|వయసు|మనస్సు|లింగము|ఇంటి|ఏటి|సంఖ్య|ఐడి|కార్డు|ఓటరు", ln):
                break
            if re.search(r"తండ్రి|తల్లి|భర్త", ln):
                break  # labeled case already handled
            if not ln or re.fullmatch(r"[|\[\]\{\}\s.:\-]+", ln):
                continue
            val = _clean_person_value(ln.split(":", 1)[-1] if ":" in ln else ln)
            if val.startswith("పేరు"):
                val = _clean_person_value(val[len("పేరు") :])
            val = re.sub(r"\s+[A-Za-z]{1,4}$", "", val).strip()
            te = len(re.findall(r"[\u0C00-\u0C7F]", val))
            if te >= 3 and _is_plausible_person(val):
                g = voter_gender or parse_gender(text)
                rtype = "Husband" if g == "Female" else "Father"
                return rtype, val
    return "", ""


def _ocr_digits(s: str) -> str:
    """Map common OCR letter confusions to digits inside an age token."""
    s = (s or "").strip()
    trans = str.maketrans({
        "O": "0", "o": "0", "Q": "0",
        "l": "1", "I": "1", "i": "1", "|": "1",
        "Z": "2", "z": "2",
        "A": "4", "h": "1", "H": "1",  # 3h/8H → 31/81
        "S": "5", "s": "5",
        "B": "8", "G": "6",
        "$": "5",
    })
    s = s.translate(trans)
    return re.sub(r"\D", "", s)


def _normalize_age(raw: int | str) -> int | None:
    """Normalize OCR age; strip leading serial-bleed digit (224→24, 344→44)."""
    digits = _ocr_digits(str(raw))
    if not digits:
        return None
    try:
        age = int(digits)
    except ValueError:
        return None
    # Neighbor/serial bleed often prefixes 1/2/3 onto a 2-digit age
    if 200 <= age <= 399:
        age = age % 100
    elif 100 <= age <= 199 and age % 100 >= 18:
        if age > 120:
            age = age % 100
    if 18 <= age <= 120:
        return age
    return None


def _telugu_digit_to_ascii(s: str) -> str:
    """Convert Telugu digits ౦-౯ to ASCII."""
    table = str.maketrans("౦౧౨౩౪౫౬౭౮౯", "0123456789")
    return (s or "").translate(table)


def parse_age(text: str) -> int | None:
    text = _telugu_digit_to_ascii(text or "")
    digit_cls = r"0-9OolI|ZhSsBAhH"
    patterns = (
        rf"వయస్సు\s*[:.\s_]*([{digit_cls}]{{1,3}})",
        rf"వయసు\s*[:.\s_]*([{digit_cls}]{{1,3}})",
        rf"వయన్సు+\s*[:.\s_]*([{digit_cls}]{{1,3}})",
        rf"మనస్సు\s*[:.\s_]*([{digit_cls}]{{1,3}})",
        rf"యస్సు\s*[:.\s_]*([{digit_cls}]{{1,3}})",
        rf"యన్సు\s*[:.\s_]*([{digit_cls}]{{1,3}})",
        rf"యనస్సు\s*[:.\s_]*([{digit_cls}]{{1,3}})",
        rf"కస్సు\s*[:.\s_]*([{digit_cls}]{{1,3}})",
        rf"(?:^|\n)\s*స్సు\s*[:.\s_]*([{digit_cls}]{{1,3}})",
        rf"(?i)(?:Age|Sosmogyy)\s*[:.\s_]*([{digit_cls}]{{1,3}})",
        # optional junk between label and digits
        rf"(?:వయస్సు|వయన్సు+|యస్సు|యన్సు|యనస్సు|మనస్సు|కస్సు|స్సు)\s*[:.\s_\"]*[^\d\n]{{0,8}}([{digit_cls}]{{1,3}})",
        # age immediately before లింగము / అంగము
        rf"(?:^|\n)[^\n]{{0,20}}?([{digit_cls}]{{2}})\s*(?:లింగము|అంగము|లీంగము)",
        # $8 / 8H style near gender
        rf"వయస్సు\s*[:.\s_]*\$?\s*([{digit_cls}]{{1,2}}H?)",
    )
    for pat in patterns:
        m = re.search(pat, text, re.I)
        if not m:
            continue
        age = _normalize_age(m.group(1))
        if age is not None:
            return age
    return None


def _normalize_house(h: str) -> str:
    h = _telugu_digit_to_ascii(h or "")
    h = clean_spaces(h).rstrip(".:|,\\").lstrip("జ+వ")
    h = h.replace(" ", "")
    # Common OCR digit confusions near house numbers
    h = h.replace("%", "5").replace("&", "8").replace("?", "7")
    # 1-197/B → keep letter suffix as-is briefly, then map B→8
    h = re.sub(r"/[Bb]$", "/8", h)
    # 1-253-2 → 1-253/2 (ward-style sub-house)
    h = re.sub(r"^(\d{1,2}-\d{1,4})-(\d{1,2})$", r"\1/\2", h)
    h = re.sub(r"^(\d{1,2})-(\d{1,4})-(\d{1,2})$", r"\1-\2/\3", h)
    # OCR letter noise inside house (keep digits / - /)
    h = re.sub(r"[^0-9/\-]", "", h)
    if not h:
        return ""
    # 141/1 → 1-41/1 ; 1372 → 1-372 ; 181 → 1-81 ; 1435 → 1-435
    if re.fullmatch(r"\d{3,}/\d+", h) and "-" not in h:
        h = h[0] + "-" + h[1:]
    elif re.fullmatch(r"\d{3,4}", h) and "-" not in h:
        h = h[0] + "-" + h[1:]
    # ౨1-296 → 21-296 OCR junk prefix before real 1-xxx
    if re.fullmatch(r"[2-9](1-\d{1,4}(?:/\d{1,2})?)", h):
        h = h[1:]
    if not re.search(r"\d", h):
        return ""
    if len(h) > 16:
        return ""
    if re.fullmatch(r"\d", h):
        return ""
    # Reject only the known truncated stub "1-2" (from 1-2xx bleed), keep 1-6 etc.
    if h == "1-2":
        return ""
    # Reject clear assembly-code OCR only (not real ఇంటి సంఖ్య 1-66)
    if re.fullmatch(r"11-\d{2}", h) or h in {"16-66", "16-69", "166-69"}:
        return ""
    # 11-388 → often bleed of 1-388
    if re.fullmatch(r"11-(\d{3}(?:/\d+)?)", h):
        h = "1-" + h[3:]
    # Accept 1-253/2 and 2-163/1
    m = re.fullmatch(r"(\d{1,2})-(\d{1,4})(?:/\d{1,2})?", h)
    if not m:
        return ""
    if len(m.group(2)) > 3 and "/" not in h:
        if m.group(1) == "1" and len(m.group(2)) == 4:
            h = f"1-{m.group(2)[:3]}"
    return h


def best_house_from_text(text: str) -> str:
    """House from explicit label lines; keep real values like 1-66 (not assembly 166-69)."""
    text = _telugu_digit_to_ascii(text or "")
    labeled: list[str] = []
    for m in re.finditer(
        r"(?:ఇంటి\s*సంఖ్య|ఇంటిసంఖ్య|ఏటి\s*సంఖ్య|[నస]?ంఖ్య|Soms|Sons|Sows|Hops|Hows|Homs)"
        r"\s*[:.+\s$]*([0-9][0-9A-Za-z/\-]{0,20})",
        text,
        re.I,
    ):
        line_start = text.rfind("\n", 0, m.start()) + 1
        line_end = text.find("\n", m.end())
        if line_end < 0:
            line_end = len(text)
        line = text[line_start:line_end]
        if re.search(r"166\s*-|అ\.ఓ|గా\.?పం|SEC", line):
            continue
        h = _normalize_house(m.group(1))
        if h:
            labeled.append(h)
    if labeled:
        return max(labeled, key=lambda x: (len(x), x.count("/")))
    return parse_house(text)


def expand_truncated_house(current: str, ocr_text: str) -> str:
    """If stored house is a prefix of the OCR house (1-6→1-66), expand it."""
    cur = (current or "").strip()
    full = best_house_from_text(ocr_text or "")
    if not full:
        return cur
    if not cur:
        return full
    if full == cur:
        return cur
    if full.startswith(cur) and len(full) > len(cur):
        rest = full[len(cur) :]
        if rest[:1].isdigit() or rest.startswith("/"):
            return full
    if full.startswith(cur + "/"):
        return full
    return cur


def parse_house(text: str) -> str:
    text = _telugu_digit_to_ascii(text or "")
    patterns = [
        r"ఇంటి\s*సంఖ్య\s*[:.+\sజ$]*([0-9][0-9A-Za-z/%?\-]{0,24})",
        r"ఇంటిసంఖ్య\s*[:.+\sజ$]*([0-9][0-9A-Za-z/%?\-]{0,24})",
        r"ఇంటిసంఖ[;$:\s.]*([0-9][0-9A-Za-z/%?\-]{0,24})",
        r"ఇంటి\s*(?:Soms|Sons|Sows|Hows|Doms|Soaps|Hops|Homs)\s*[:.\s]*([0-9][0-9A-Za-z/%?\-]{0,24})",
        r"ఏటి\s*సంఖ్య\s*[:.+\s]*([0-9][0-9A-Za-z/%?\-]{0,24})",
        r"ఏటి\s*(?:Soms|Sons|Sows|Soaps)\s*[:.\s]*([0-9][0-9A-Za-z/%?\-]{0,24})",
        r"టి\s*(?:సంఖ్య?|Soms|Sons|Sows|Soaps)\s*[,:.\s]*([0-9][0-9A-Za-z/%?\-]{0,24})",
        r"టి\s*సంఖ్య?\s*[:.\s]*([0-9][0-9A-Za-z/%?\-]{0,24})",
        r"[నస]ంఖ్య\s*[:.+\s]*([0-9][0-9/\-]{1,20})",
        r"(?i)(?:Rot|Bot|pot|Fao|ROB|my\s*pot)\s*(?:Sons|Soms|Sows)\s*[:.\s]*([0-9][0-9A-Za-z/%?\-]{0,24})",
        r"(?i)House\s*(?:No\.?)?\s*[:.\s]*([0-9][0-9A-Za-z/%?\-]{0,24})",
        r"(?i)(?:Sows?|Hops|Homs|Hows)\s*[:.\s]*([0-9][0-9A-Za-z/%?\-]{0,24})",
        r"సంఖ్య\s*[:.\s]*([0-9][0-9/\-]{1,20})",
        r"సంఖ\s*[:.\s]*([0-9][0-9/\-]{1,20})",
        r"సంఖ్య?\s*[:.\s+]*([0-9][0-9/\-]{1,20})",
        # 1-253-2 / 2-178-1 sub-house forms
        r"(?:^|\n)\s*([0-9]{1,2}-[0-9]{1,4}(?:[/-][0-9A-Za-z]{1,2})?)\s*(?:\n|$)",
    ]
    for pat in patterns:
        for m in re.finditer(pat, text):
            line_start = text.rfind("\n", 0, m.start()) + 1
            line_end = text.find("\n", m.end())
            if line_end < 0:
                line_end = len(text)
            line = text[line_start:line_end]
            # Skip assembly / section header bleed (166-69-xxx)
            if re.search(r"166\s*-|అ\.ఓ|గా\.?పం|SEC", line):
                continue
            h = _normalize_house(m.group(1))
            if h:
                return h
    return ""


def parse_gender(text: str) -> str:
    """Parse gender; tolerate heavy OCR mangling of లింగము / స్త్రీ / పు."""
    t = text or ""
    # Avoid `[:` in char classes (POSIX trap in newer Python re).
    sep = r"[.:()\s]*"
    # Female markers (స్త్రీ and common OCR corruptions)
    if re.search(
        rf"స్త్రీ|స్తీ|స్రీ|\(స్తీ|\(సీ|\(్తీ|Female|"
        rf"లింగమ[ుుం్మ]*\s*{sep}[&$]|"
        rf"లింగమ[ుుం్మ]*\s*{sep}LQ|"
        rf"లింగమ[ుుం్మ]*\s*{sep}UR|"
        rf"(?:లింగ|అంగము)\s*{sep}స్",
        t,
        re.I,
    ):
        return "Female"
    # Male markers (పు / వు) after gender label
    if re.search(
        rf"(?:లింగమ[ుుం్మ]*|అంగము|లీంగము|ల్తింగము)\s*{sep}[పవ]ు|"
        r"\bMale\b",
        t,
        re.I,
    ):
        return "Male"
    # Label present with పు/వు elsewhere on same area, no female marker
    if re.search(r"లింగమ|అంగము|లీంగము", t) and re.search(
        r"(?:^|[^\u0C00-\u0C7F])పు(?:\s|$|[^\u0C00-\u0C7F])", t
    ):
        if not re.search(r"స్త్|స్రీ|Female", t, re.I):
            return "Male"
    # Husband relation on card ⇒ female voter (strong electoral-roll convention)
    if re.search(r"భర్త\s*పేరు|భర్తపేరు", t):
        return "Female"
    return ""


def infer_gender(text: str = "", relation_type: str = "", relation_name: str = "") -> str:
    g = parse_gender(text)
    if g:
        return g
    rt = (relation_type or "").strip()
    if rt == "Husband" or re.search(r"భర్త", text or ""):
        return "Female"
    if rt == "Father" and re.search(r"పు", text or "") and not re.search(r"స్త్|స్రీ", text or ""):
        return "Male"
    return ""


def _is_header_noise(ln: str) -> bool:
    return bool(
        re.search(
            r"అ\.ఓ|గా\.?పం|గ్రాపం|SEC|166\s*-|పుట\s*సంఖ|ప్రచురణ|వయస్సు\s*లెక్క|"
            r"ANDHRA|watermark",
            ln,
            re.I,
        )
    )


def _is_meta_line(ln: str) -> bool:
    return bool(
        re.search(
            r"వయస్సు|వయసు|వయన్సు|మనస్సు|యస్సు|యన్సు|లింగము|అంగము|ఇంటి|ఏటి|సంఖ్య|"
            r"ఐడి|కార్డు|నెం\.?|IAX|BDG|Soms|Sons|Sows|Soaps|House",
            ln,
            re.I,
        )
    )


def _person_from_line(ln: str) -> str:
    """Extract a person-name value from a layout line (label optional)."""
    s = ln.strip()
    if not s or _is_header_noise(s) or _is_meta_line(s):
        return ""
    # Drop known labels then take remainder
    s = re.sub(
        r"^(?:ఓటరు\s*)?(?:పేరు|Dd|od|Do|bo|OO|dd)\)?\s*[:.\s]*",
        "",
        s,
        flags=re.I,
    )
    s = re.sub(
        r"^(?:తండ్రి|తండి|తల్లి|భర్త)\s*పేరు\.?\s*[:.\s]*",
        "",
        s,
    )
    s = re.sub(
        r"^(?:Ad|AD|Wd|Bb|BD|BSD|pad|DO|1G|IG|Dod|Sard)\s*[:.\s]*",
        "",
        s,
        flags=re.I,
    )
    if ":" in s:
        # prefer value after last-ish colon if label-like prefix
        left, right = s.split(":", 1)
        if len(re.findall(r"[\u0C00-\u0C7F]", right)) >= 2:
            s = right
    val = _clean_person_value(s)
    val = re.sub(r"^\d{1,4}\s+", "", val)
    # Strip mangled label crumbs left as the whole "name" (DI, Dd, డి పేరు)
    val = re.sub(r"^(?:డి|డ్రి|Dd|DI|Do|bo)\s*పేరు\s*", "", val, flags=re.I)
    val = re.sub(r"^(?:డి|డ్రి)\s+", "", val)
    if re.fullmatch(r"(?:DI|Dd|Do|bo|డి|డ్రి|పేరు)", val or "", re.I):
        return ""
    if not _is_plausible_person(val):
        return ""
    if looks_like_garbage_name(val):
        return ""
    if len(re.findall(r"[\u0C00-\u0C7F]", val)) < 3 and len(val) <= 3:
        return ""
    return val


def extract_pii_by_layout(text: str) -> dict:
    """Positional PII when field headers are missing/mangled.

    Standard AP elector card order (top → bottom):
      1) voter name
      2) relation name (father/husband/mother)
      3) age + gender
      4) house number
      5) EPIC
    """
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    # Drop pure header / watermark lines
    body = [ln for ln in lines if not _is_header_noise(ln)]

    # Split at age/gender / house / epic boundaries
    person_zone: list[str] = []
    for ln in body:
        if _is_meta_line(ln) and re.search(
            r"వయస|లింగము|ఇంటి|ఏటి|సంఖ్య|ఐడి|కార్డు|IAX|BDG|Soms|Sons|House", ln, re.I
        ):
            # age line may still carry a trailing person? usually not
            break
        # relation/name label lines stay in person zone
        person_zone.append(ln)

    persons: list[str] = []
    for ln in person_zone:
        # skip lines that are only relation-type labels with no value yet handled
        val = _person_from_line(ln)
        if not val:
            continue
        # de-dupe consecutive repeats
        if persons and persons[-1] == val:
            continue
        persons.append(val)

    name_te = persons[0] if len(persons) >= 1 else ""
    rel_te = persons[1] if len(persons) >= 2 else ""

    # If card is truncated and starts with relation label, first person is relation
    head = " ".join(body[:2])
    starts_with_rel = bool(re.search(r"^(తండ్రి|తండి|తల్లి|భర్త)\s*పేరు", head))
    has_name_label = bool(re.search(r"ఓటరు\s*పేరు|ఏరు\s*పేరు|రు\s*పేరు", text or ""))
    if starts_with_rel and not has_name_label:
        # persons[0] is relation, not voter name
        rel_te = persons[0] if persons else ""
        name_te = ""

    gender = parse_gender(text)
    if re.search(r"భర్త", text or ""):
        rel_type = "Husband"
    elif re.search(r"తల్లి", text or ""):
        rel_type = "Mother"
    elif re.search(r"తండ్రి|తండి", text or ""):
        rel_type = "Father"
    else:
        rel_type = "Husband" if gender == "Female" else ("Father" if rel_te else "")

    if name_te and rel_te and name_te == rel_te:
        rel_te, rel_type = "", ""

    return {
        "nameTe": name_te,
        "relationType": rel_type if rel_te else "",
        "relationNameTe": rel_te,
        "age": parse_age(text),
        "gender": gender,
        "house": parse_house(text),
        "epic": extract_epic(text or "", ""),
        "layoutPersons": persons,
        "truncatedCard": bool(starts_with_rel and not has_name_label),
    }


def merge_pii(labeled: dict, layout: dict) -> dict:
    """Merge labeled parsers with layout fallback; prefer non-empty quality values."""
    name = labeled.get("nameTe") or ""
    if not name or looks_like_garbage_name(name):
        name = layout.get("nameTe") or name
    rel_te = labeled.get("relationNameTe") or ""
    rel_type = labeled.get("relationType") or ""
    if not rel_te:
        rel_te = layout.get("relationNameTe") or ""
        rel_type = layout.get("relationType") or rel_type
    # Truncated card: never keep a stolen name
    if layout.get("truncatedCard"):
        if not labeled.get("nameTe") or looks_like_garbage_name(labeled.get("nameTe") or ""):
            name = ""
    if name and rel_te and (
        name == rel_te or to_english(name).lower() == to_english(rel_te).lower()
    ):
        # Prefer keeping name; drop relation copy
        if labeled.get("relationNameTe") and labeled.get("relationNameTe") != name:
            rel_te = labeled.get("relationNameTe") or ""
            rel_type = labeled.get("relationType") or rel_type
        else:
            rel_te, rel_type = "", ""
    gender = labeled.get("gender") or layout.get("gender") or ""
    age = labeled.get("age")
    if age is None:
        age = layout.get("age")
    house = labeled.get("house") or layout.get("house") or ""
    epic = labeled.get("epic") or layout.get("epic") or ""
    return {
        "nameTe": name,
        "name": to_english(name) if name else "",
        "relationType": rel_type if rel_te else "",
        "relationNameTe": rel_te,
        "relationName": to_english(rel_te) if rel_te else "",
        "age": age,
        "gender": gender,
        "house": house,
        "epic": epic,
        "truncatedCard": bool(layout.get("truncatedCard")),
    }


def reparse_row(row: dict) -> dict:
    text = row.get("ocrText") or ""
    epic = extract_epic(text, row.get("epic") or "")
    name_te = parse_name(text)
    age = parse_age(text)
    house = parse_house(text)
    gender = parse_gender(text)
    rel_type, rel_te = parse_relation(text, voter_gender=gender)
    gender = infer_gender(text, rel_type, rel_te) or gender
    labeled = {
        "epic": epic,
        "nameTe": name_te,
        "relationType": rel_type,
        "relationNameTe": rel_te,
        "age": age,
        "gender": gender,
        "house": house,
    }
    layout = extract_pii_by_layout(text)
    merged = merge_pii(labeled, layout)
    if merged.get("epic"):
        epic = merged["epic"]
    house = expand_truncated_house(merged.get("house") or "", text)
    if not house:
        house = best_house_from_text(text) or ""
    gender = (
        merged.get("gender")
        or infer_gender(text, merged.get("relationType") or "", merged.get("relationNameTe") or "")
        or ""
    )
    return {
        **row,
        "epic": epic,
        "nameTe": merged.get("nameTe") or "",
        "name": merged.get("name") or "",
        "relationType": merged.get("relationType") or "",
        "relationNameTe": merged.get("relationNameTe") or "",
        "relationName": merged.get("relationName") or "",
        "age": merged.get("age"),
        "gender": gender,
        "house": house,
        "truncatedCard": merged.get("truncatedCard", False),
    }


def resolve_neighbor_conflicts(rows: list[dict]) -> list[dict]:
    """Clear PII that was clearly copied from previous/next voter (OCR bleed)."""
    out = [dict(r) for r in rows]
    for i, row in enumerate(out):
        prev = out[i - 1] if i > 0 else None
        nxt = out[i + 1] if i + 1 < len(out) else None
        name = (row.get("name") or "").strip()
        rel = (row.get("relationName") or "").strip()
        house = (row.get("house") or "").strip()

        if prev:
            pn = (prev.get("name") or "").strip()
            pr = (prev.get("relationName") or "").strip()
            ph = (prev.get("house") or "").strip()
            # Name identical to previous name/relation → bleed
            if name and pn and name.lower() == pn.lower():
                # keep only if EPICs match (same person dup); else clear
                if (row.get("epic") or "") != (prev.get("epic") or ""):
                    row["name"] = ""
                    row["nameTe"] = ""
                    name = ""
            if name and pr and name.lower() == pr.lower() and name.lower() != rel.lower():
                # current name equals previous relation — often vertical bleed
                if not row.get("nameTe") or looks_like_garbage_name(row.get("nameTe") or name):
                    row["name"] = ""
                    row["nameTe"] = ""
                    name = ""
            # House copied from previous when current OCR missed house label
            if house and ph and house == ph:
                # allow same house for family; only clear if also name bleed signals
                if not name and not rel:
                    row["house"] = ""
                    house = ""

        if nxt:
            nn = (nxt.get("name") or "").strip()
            if name and nn and name.lower() == nn.lower():
                if (row.get("epic") or "") != (nxt.get("epic") or ""):
                    # prefer next (often current stole next's name from below)
                    pass

        # Self conflict
        if name and rel and name.lower() == rel.lower():
            row["relationName"] = ""
            row["relationNameTe"] = ""
            row["relationType"] = ""

        # Assembly-code false houses
        if house in {"16-66", "16-69", "166-69"} or re.fullmatch(r"11-\d{2}", house or ""):
            row["house"] = ""

        # Truncated card flag: ensure name empty when only relation present in OCR
        if row.get("truncatedCard") and not (row.get("ocrText") and re.search(r"ఓటరు\s*పేరు|ఏరు\s*పేరు", row.get("ocrText") or "")):
            if looks_like_garbage_name(row.get("nameTe") or row.get("name") or "") or (
                rel and name and name.lower() == rel.lower()
            ):
                row["name"] = ""
                row["nameTe"] = ""
    return out


def main() -> None:
    raw = json.loads(RAW.read_text(encoding="utf-8"))
    rows = [reparse_row(r) for r in raw.get("rows", [])]

    by_epic: dict[str, dict] = {}
    no_epic = 0
    for row in rows:
        epic = (row.get("epic") or "").upper()
        if not epic or not re.fullmatch(r"[A-Z]{3}\d{7}", epic):
            no_epic += 1
            continue
        prev = by_epic.get(epic)
        score = (
            (2 if row.get("name") else 0)
            + (1 if row.get("age") else 0)
            + (1 if row.get("house") else 0)
            + (1 if row.get("gender") else 0)
        )
        prev_score = 0
        if prev:
            prev_score = (
                (2 if prev.get("name") else 0)
                + (1 if prev.get("age") else 0)
                + (1 if prev.get("house") else 0)
                + (1 if prev.get("gender") else 0)
            )
        if not prev or score >= prev_score:
            by_epic[epic] = row

    # Rename photos from old epic path when possible
    renamed = 0
    for epic, row in by_epic.items():
        old_photo = row.get("photo") or ""
        dest = PHOTO_DIR / f"{epic}.jpg"
        # try old filename from previous epic in ocr if different
        candidates = []
        if old_photo.startswith("/photos/"):
            candidates.append(PHOTO_DIR / old_photo.split("/")[-1])
        old_epic = (row.get("epicOcr") or "")[:10]
        # also try common wrong prefixes with same digits
        digits = epic[3:]
        for pre in ("IXX", "IIX", "IXO", "IOX", "III", "IAN", "IAX", "BDG"):
            candidates.append(PHOTO_DIR / f"{pre}{digits}.jpg")
        src = next((p for p in candidates if p.exists() and p != dest), None)
        if src and not dest.exists():
            shutil.copy2(src, dest)
            renamed += 1
        elif dest.exists():
            pass
        row["photo"] = f"/photos/{epic}.jpg" if dest.exists() or src else ""

    voters = []
    serial_n = 0
    for ward in range(1, 17):
        ward_rows = [r for r in by_epic.values() if r.get("ward") == ward]
        ward_rows.sort(key=lambda r: (r.get("page") or 0, r.get("y") or 0, r.get("col") or 0, r.get("cardIndex") or 0))
        for row in ward_rows:
            serial_n += 1
            if not row.get("photo") and (PHOTO_DIR / f"{row['epic']}.jpg").exists():
                row["photo"] = f"/photos/{row['epic']}.jpg"
            voters.append(build_voter(row, serial_n))

    voters.sort(key=lambda v: (v["ward"] or 0, v["serial"]))

    meta = {
        "panchayat": APP_NAME,
        "appName": APP_NAME,
        "mainTown": PANCHAYAT,
        "district": DISTRICT,
        "mandal": MANDAL,
        "assembly": ASSEMBLY,
        "year": YEAR,
        "total": len(voters),
        "male": sum(1 for v in voters if v["gender"] == "Male"),
        "female": sum(1 for v in voters if v["gender"] == "Female"),
        "wards": sorted({v["ward"] for v in voters if v["ward"]}),
        "photosMapped": sum(1 for v in voters if v.get("photo")),
        "habitations": [
            {"id": 1, "name": PANCHAYAT, "nameTe": "దామలచెరువు", "from": 1, "to": len(voters)}
        ],
        "source": "data/Damalacheruvu WARD *.pdf (OCR, reparsed)",
        "ocrNoEpicCards": no_epic,
        "reparsedFrom": str(RAW.relative_to(ROOT)),
    }

    payload = {"meta": meta, "voters": voters}
    text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    OUT.write_text(text, encoding="utf-8")
    LATEST.write_text(text, encoding="utf-8")

    prefs = Counter(v["epic"][:3] for v in voters)
    print(
        f"Wrote {len(voters)} voters → {OUT.name} + voters_latest.json\n"
        f"male={meta['male']} female={meta['female']} photos={meta['photosMapped']}\n"
        f"missing_name={sum(1 for v in voters if not v['name'])} "
        f"missing_age={sum(1 for v in voters if v.get('age') is None)} "
        f"missing_house={sum(1 for v in voters if not v.get('house'))} "
        f"missing_gender={sum(1 for v in voters if not v.get('gender'))}\n"
        f"epic_prefixes={prefs.most_common(8)} photos_renamed≈{renamed} no_epic_rows={no_epic}"
    )
    if voters:
        print("sample:", json.dumps(voters[0], ensure_ascii=False)[:350])


if __name__ == "__main__":
    main()
