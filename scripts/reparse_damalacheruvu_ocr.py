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


def parse_name(text: str) -> str:
    # tolerate OCR variants of ఓటరు పేరు
    patterns = [
        r"ఓటరు\s*పేరు\s*[:.\s]*([^\n]+)",
        r"ఓటరు\s*పేరు\.?\s*[:.\s]*([^\n]+)",
        r"ఓటరు\s*[:.\s]*([^\n]{2,})",
        r"ఏరు\s*bo\s*[:.\s]*([^\n]+)",  # common OCR mangling
        r"Lod\s*(?:Do|bo|Dd)\s*[:.\s]*([^\n]+)",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.I)
        if not m:
            continue
        val = clean_spaces(m.group(1))
        val = re.split(r"తండ్రి|తల్లి|భర్త|వయస్సు|లింగము|ఇంటి|ఐడి", val)[0]
        val = clean_spaces(re.sub(r"^[:.\s]+", "", val))
        # reject if looks like EPIC / label junk
        if not val or len(val) < 2:
            continue
        if re.search(r"(కార్డు|నెం|IAX|BDG|\d{7})", val, re.I):
            continue
        if val.startswith("పేరు"):
            continue
        return val
    return ""


def parse_relation(text: str) -> tuple[str, str]:
    for label, rtype in (
        ("భర్త పేరు", "Husband"),
        ("భర్తపేరు", "Husband"),
        ("తండ్రి పేరు", "Father"),
        ("తండ్రిపేరు", "Father"),
        ("తల్లి పేరు", "Mother"),
        ("తల్లిపేరు", "Mother"),
        ("తంది పేరు", "Father"),
    ):
        if label in text:
            after = text.split(label, 1)[1]
            after = re.split(r"వయస్సు|లింగము|ఇంటి|మనస్సు|ఓటరు", after)[0]
            val = clean_spaces(re.sub(r"^[:.\s]+", "", after))
            val = re.sub(r"[|\[\]]+", " ", val)
            val = clean_spaces(val)
            if val and not re.search(r"\d{7}", val):
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


def parse_house(text: str) -> str:
    for pat in (
        r"ఇంటి\s*సంఖ్య\s*[:.\s]*([0-9][0-9A-Za-z/\-]{0,24})",
        r"ఇంటిసంఖ్య\s*[:.\s]*([0-9][0-9A-Za-z/\-]{0,24})",
        r"ఏటి\s*సంఖ్య\s*[:.\s]*([0-9][0-9A-Za-z/\-]{0,24})",
        r"House\s*(?:No\.?)?\s*[:.\s]*([0-9][0-9A-Za-z/\-]{0,24})",
    ):
        m = re.search(pat, text, re.I)
        if m:
            h = clean_spaces(m.group(1)).rstrip(".:|")
            # normalize 141/1 → 1-41/1 when missing dash after first digit cluster
            if re.fullmatch(r"\d{3,}/\d+", h) and "-" not in h:
                h = h[0] + "-" + h[1:]
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
