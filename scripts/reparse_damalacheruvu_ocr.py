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
    val = re.sub(r"^[:.\s\|\-_]+", "", val)
    val = re.split(
        r"తండ్రి|తల్లి|భర్త|వయస్సు|వయసు|మనస్సు|లింగము|ఇంటి|ఏటి|ఐడి|కార్డు|నెం|"
        r"Father|Mother|Husband|Age|House",
        val,
        maxsplit=1,
    )[0]
    val = clean_spaces(re.sub(r"[|\[\]\{\}]+", " ", val))
    val = re.sub(r"[\u200c\u200d]+", "", val)  # ZWJ/ZWNJ noise
    return clean_spaces(val)


def _is_plausible_person(val: str) -> bool:
    if not val or len(val) < 2:
        return False
    if re.search(r"(కార్డు|నెం|IAX|BDG|\d{6,})", val, re.I):
        return False
    if re.fullmatch(r"[:.\-\s]+", val):
        return False
    # mostly punctuation / latin OCR garbage only
    letters = re.sub(r"[^A-Za-z\u0C00-\u0C7F]", "", val)
    if len(letters) < 2:
        return False
    return True


def parse_name(text: str) -> str:
    """Extract voter name; tolerate heavy Telugu OCR mangling of ఓటరు పేరు."""
    patterns = [
        r"ఓటరు\s*పేరు\.?\s*[:.\s]*([^\n]+)",
        r"ఓటరుపేరు\.?\s*[:.\s]*([^\n]+)",
        r"ఓటరు\s*[:.\s]*([^\n]{2,40})",
        r"ఏరు\s*పేరు\.?\s*[:.\s]*([^\n]+)",
        r"ఏరు\s*boo?\s*[:.\s]*([^\n]+)",
        r"ఏరు\s*bo\s*[:.\s]*([^\n]+)",
        r"(?i)l+o[do]\s*b[o0h]\s*[:.\s]*([^\n]+)",  # Loo/Lob/Lod bo
        r"(?i)so+o?\s*bh?\s*[:.\s]*([^\n]+)",  # soo bh
        r"(?i)no+b\s*[:.\s]*([^\n]+)",  # noob :
        r"(?i)(?:^|\n)\s*(?:bo+|bh)\s*[:.\s]+([^\n]{2,40})",
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
        if _is_plausible_person(val):
            return val

    # Fallback: first Telugu-heavy line after a header, before age/gender
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for i, ln in enumerate(lines):
        if re.search(r"వయస్సు|లింగము|ఇంటి|ఐడి|కార్డు", ln):
            break
        if re.search(r"తండ్రి|తల్లి|భర్త", ln):
            break
        # skip pure serial/header lines
        if re.search(r"అ\.ఓ|గా\.పం|SEC|166\s*-", ln):
            continue
        te = len(re.findall(r"[\u0C00-\u0C7F]", ln))
        if te >= 3 and "పేరు" not in ln:
            # line may be "label : value" already handled; try raw
            if ":" in ln:
                val = _clean_person_value(ln.split(":", 1)[1])
            else:
                val = _clean_person_value(ln)
            if _is_plausible_person(val) and not re.match(r"^(వయస్|లింగ|ఇంటి)", val):
                return val
    return ""


def parse_relation(text: str) -> tuple[str, str]:
    patterns = [
        (r"భర్త\s*పేరు\.?\s*[:.\s]*([^\n]+)", "Husband"),
        (r"భర్తపేరు\.?\s*[:.\s]*([^\n]+)", "Husband"),
        (r"భర్త[^\n]{0,6}[:.\s]+([^\n]+)", "Husband"),  # భర్తశ్హురు / భర్తశ్లేరు
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
        (r"(?i)so+g\s*bo\s*[:.\s]*([^\n]+)", "Father"),
        (r"(?i)2\|\|\s*తండి\s*పేరు\.?\s*[:.\s]*([^\n]+)", "Father"),
    ]
    for pat, rtype in patterns:
        m = re.search(pat, text)
        if not m:
            continue
        val = _clean_person_value(m.group(1))
        if _is_plausible_person(val):
            return rtype, val

    # Label on one line, value on next
    lines = [ln.strip() for ln in text.splitlines()]
    for i, ln in enumerate(lines):
        rtype = ""
        if re.search(r"భర్త", ln):
            rtype = "Husband"
        elif re.search(r"తండ్రి|తండి", ln):
            rtype = "Father"
        elif re.search(r"తల్లి", ln):
            rtype = "Mother"
        if not rtype:
            continue
        if ":" in ln:
            val = _clean_person_value(ln.split(":", 1)[1])
            if _is_plausible_person(val):
                return rtype, val
        if i + 1 < len(lines):
            nxt = lines[i + 1]
            if re.search(r"వయస్సు|లింగము|ఇంటి|ఓటరు", nxt):
                continue
            val = _clean_person_value(nxt.split(":", 1)[-1] if ":" in nxt else nxt)
            if _is_plausible_person(val):
                return rtype, val
    return "", ""


def parse_age(text: str) -> int | None:
    for pat in (
        r"వయస్సు\s*[:.\s_]*(\d{1,3})",
        r"వయసు\s*[:.\s_]*(\d{1,3})",
        r"మనస్సు\s*[:.\s_]*(\d{1,3})",  # OCR misspelling
        r"Age\s*[:.\s]*(\d{1,3})",
    ):
        m = re.search(pat, text, re.I)
        if m:
            age = int(m.group(1))
            if 18 <= age <= 120:
                return age
    return None


def _normalize_house(h: str) -> str:
    h = clean_spaces(h or "").rstrip(".:|,").lstrip("జ+")
    h = h.replace(" ", "")
    # OCR letter noise inside house
    h = re.sub(r"[^0-9/\-]", "", h)
    if not h:
        return ""
    # 141/1 → 1-41/1 ; 1391 → 1-391 ; 181 → 1-81 when 3 digits
    if re.fullmatch(r"\d{3,}/\d+", h) and "-" not in h:
        h = h[0] + "-" + h[1:]
    elif re.fullmatch(r"\d{3,4}", h) and "-" not in h:
        h = h[0] + "-" + h[1:]
    # keep only plausible house patterns
    if not re.search(r"\d", h):
        return ""
    if len(h) > 20:
        return ""
    return h


def parse_house(text: str) -> str:
    patterns = [
        r"ఇంటి\s*సంఖ్య\s*[:.\sజ]*([0-9][0-9A-Za-z/\-]{0,24})",
        r"ఇంటిసంఖ్య\s*[:.\sజ]*([0-9][0-9A-Za-z/\-]{0,24})",
        r"ఇంటి\s*(?:Soms|Sons|Sows|Hows|Doms)\s*[:.\s]*([0-9][0-9A-Za-z/\-]{0,24})",
        r"ఏటి\s*సంఖ్య\s*[:.+\s]*([0-9][0-9A-Za-z/\-]{0,24})",
        r"ఏటి\s*(?:Soms|Sons|Sows)\s*[:.\s]*([0-9][0-9A-Za-z/\-]{0,24})",
        r"టి\s*సంఖ్య?\s*[:.\s]*([0-9][0-9A-Za-z/\-]{0,24})",
        r"సంఖ\s*[:.\s]*([0-9][0-9/\-]{1,20})",
        r"(?i)(?:Rot|Bot|pot|Fao|ROB|my\s*pot)\s*(?:Sons|Soms|Sows)\s*[:.\s]*([0-9][0-9A-Za-z/\-]{0,24})",
        r"(?i)House\s*(?:No\.?)?\s*[:.\s]*([0-9][0-9A-Za-z/\-]{0,24})",
        # bare "సంఖ్య :1-271" style
        r"సంఖ్య\s*[:.\s+]*([0-9][0-9/\-]{1,20})",
    ]
    for pat in patterns:
        m = re.search(pat, text)
        if not m:
            continue
        h = _normalize_house(m.group(1))
        if h:
            return h
    return ""


def parse_gender(text: str) -> str:
    if re.search(r"స్త్రీ|స్తీ|\(స్తీ|\(సీ|Female", text, re.I):
        return "Female"
    if re.search(r"లింగము\s*[:.\s]*పు|\bMale\b", text, re.I):
        return "Male"
    if "లింగము" in text and "పు" in text and "స్త్" not in text:
        return "Male"
    return ""


def reparse_row(row: dict) -> dict:
    text = row.get("ocrText") or ""
    epic = extract_epic(text, row.get("epic") or "")
    name_te = parse_name(text)
    rel_type, rel_te = parse_relation(text)
    age = parse_age(text)
    house = parse_house(text)
    gender = parse_gender(text)
    return {
        **row,
        "epic": epic,
        "nameTe": name_te,
        "name": to_english(name_te) if name_te else "",
        "relationType": rel_type,
        "relationNameTe": rel_te,
        "relationName": to_english(rel_te) if rel_te else "",
        "age": age,
        "gender": gender,
        "house": house,
    }


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
