#!/usr/bin/env python3
"""OCR Damalacheruvu ward PDFs (image-only) → voters.json + photos for the UI.

Requires: tesseract with `tel` + `eng` (brew install tesseract tesseract-lang),
pymupdf, Pillow, indic-transliteration.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import fitz
from indic_transliteration import sanscript
from indic_transliteration.sanscript import transliterate
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DATA_PDF = ROOT / "data"
OUT_JSON = ROOT / "web" / "public" / "data" / "voters.json"
OUT_BACKUP = ROOT / "web" / "public" / "data" / "voters_chukkavaripalli_backup.json"
PHOTO_DIR = ROOT / "web" / "public" / "photos"
OCR_CACHE = ROOT / "data" / "ocr_cache"
TESSERACT = Path("/opt/homebrew/bin/tesseract")

ZOOM = 2.0
WORKERS = max(6, min(12, (os.cpu_count() or 8)))

PANCHAYAT = "Damalacheruvu"
APP_NAME = "Sarpanch Elections Damalacheruvu"
DISTRICT = "Tirupati"
MANDAL = "Pakala"
ASSEMBLY = "Chandragiri"
YEAR = 2026

EPIC_RE = re.compile(r"\b([A-Z]{3}\d{7})\b")
AGE_RE = re.compile(r"(?:వయస్సు|వయసు|Age)\s*[:.\s]*(\d{1,3})", re.I)
HOUSE_RE = re.compile(
    r"(?:ఇంటి\s*సంఖ్య|House)\s*[:.\s]*([0-9][0-9A-Za-z/\-]{0,20})",
    re.I,
)
SERIAL_RE = re.compile(r"[\[\(]?(\d{1,4})[\]\)]?")


WORD_FIX = [
    (r"\bNayudu\b", "Naidu"),
    (r"\bReddi\b", "Reddy"),
    (r"\bChamdra\b", "Chandra"),
    (r"\bVemkata\b", "Venkata"),
]


def clean_spaces(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("\xa0", " ")).strip()


def to_english(s: str) -> str:
    s = clean_spaces(s)
    if not s:
        return ""
    s = re.sub(r"(తండ్రి+|తల్లి|భర్త|వయస్సు|లింగము|ఇంటి\s*సంఖ్య|పేరు).*$", "", s).strip()
    if not s:
        return ""
    if re.fullmatch(r"[A-Za-z0-9 .,\-/]+", s):
        out = s
    else:
        try:
            t = transliterate(s, sanscript.TELUGU, sanscript.ITRANS)
        except Exception:
            return s
        t = (
            t.replace("~N", "n")
            .replace("^N", "n")
            .replace(".n", "n")
            .replace(".m", "m")
            .replace(".h", "")
            .replace("aa", "a")
            .replace("ii", "i")
            .replace("uu", "u")
        )
        words = []
        for w in t.split():
            if len(w) <= 2 and w.isalpha():
                words.append(w.upper())
            else:
                words.append(w.capitalize())
        out = " ".join(words)
    for a, b in WORD_FIX:
        out = re.sub(a, b, out)
    return re.sub(r"\s+", " ", out).strip()


def age_band(age: int | None) -> str:
    if age is None:
        return ""
    if age <= 25:
        return "18–25"
    if age <= 35:
        return "26–35"
    if age <= 45:
        return "36–45"
    if age <= 55:
        return "46–55"
    if age <= 65:
        return "56–65"
    return "65+"


def fix_epic(raw: str) -> str:
    s = (raw or "").upper().replace(" ", "").replace("O", "0")
    # common OCR confusions at start
    s = s.replace("1AX", "IAX").replace("TAX", "IAX").replace("LAX", "IAX")
    s = s.replace("8DG", "BDG").replace("BOG", "BDG")
    m = EPIC_RE.search(s)
    if m:
        return m.group(1)
    # fuzzy: 3 letters + 7 digits with OCR junk
    m = re.search(r"([A-Z0-9]{3})(\d{7})", s)
    if m:
        prefix = m.group(1).replace("1", "I").replace("0", "O")
        if prefix[0].isdigit():
            prefix = "I" + prefix[1:]
        prefix = re.sub(r"[^A-Z]", "X", prefix)[:3]
        return (prefix + m.group(2))[:10]
    return ""


def parse_gender(text: str) -> str:
    if "స్త్రీ" in text or "స్తీ" in text or re.search(r"Female", text, re.I):
        return "Female"
    if re.search(r"లింగము\s*[:.\s]*పు", text) or re.search(r"\bMale\b", text, re.I):
        return "Male"
    if "పు" in text and "స్త్" not in text:
        return "Male"
    return ""


def parse_relation(text: str) -> tuple[str, str]:
    for label, rtype in (
        ("భర్త పేరు", "Husband"),
        ("భర్తపేరు", "Husband"),
        ("తండ్రి పేరు", "Father"),
        ("తండ్రిపేరు", "Father"),
        ("తల్లి పేరు", "Mother"),
        ("తల్లిపేరు", "Mother"),
    ):
        if label in text:
            after = text.split(label, 1)[1]
            after = re.split(r"వయస్సు|లింగము|ఇంటి", after)[0]
            val = clean_spaces(re.sub(r"^[:.\s]+", "", after))
            val = re.sub(r"[|\[\]]+", " ", val)
            return rtype, val
    return "", ""


def parse_name(text: str) -> str:
    m = re.search(r"ఓటరు\s*పేరు\s*[:.\s]*([^\n]+)", text)
    if not m:
        m = re.search(r"ఓటరు\s*[:.\s]*([^\n]+)", text)
    if not m:
        return ""
    val = clean_spaces(m.group(1))
    val = re.split(r"తండ్రి|తల్లి|భర్త|వయస్సు", val)[0]
    return clean_spaces(val)


def run_tesseract(image_path: Path, lang: str = "tel+eng", psm: int = 6) -> str:
    cmd = [
        str(TESSERACT),
        str(image_path),
        "stdout",
        "-l",
        lang,
        "--oem",
        "1",
        "--psm",
        str(psm),
    ]
    try:
        out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, timeout=45)
        return out.decode("utf-8", errors="ignore")
    except Exception:
        return ""


def list_photos(page: fitz.Page) -> list[tuple[float, float, float, float]]:
    photos = []
    for info in page.get_image_info(xrefs=True):
        b = info["bbox"]
        w, h = b[2] - b[0], b[3] - b[1]
        if 28 < w < 55 and 28 < h < 55:
            photos.append((b[0], b[1], b[2], b[3]))
    photos.sort(key=lambda b: (round(b[1]), b[0]))
    return photos


def card_boxes_for_page(page: fitz.Page, zoom: float) -> list[dict]:
    """Return card crop boxes in pixel coords + photo PDF bbox."""
    photos = list_photos(page)
    if len(photos) < 1:
        return []
    ys = sorted({round(p[1]) for p in photos})
    xs = sorted({round(p[0]) for p in photos})
    if len(ys) >= 2:
        row_gap = (ys[1] - ys[0]) * zoom
    else:
        row_gap = 72 * zoom
    page_w = page.rect.width * zoom
    left_margin = 16 * zoom
    n_cols = max(1, len(xs))
    col_w = (page_w - 2 * left_margin) / max(3, n_cols) if n_cols else page_w
    # Prefer 3-column layout
    col_w = (page_w - 2 * left_margin) / 3

    boxes = []
    for b in photos:
        px0, py0, px1, py1 = [v * zoom for v in b]
        # nearest column by photo x
        col_idx = min(range(3), key=lambda i: abs(left_margin + i * col_w + col_w * 0.78 - (px0 + px1) / 2))
        col_left = left_margin + col_idx * col_w
        col_right = col_left + col_w
        # Include serial + name line above the photo
        card_top = py0 - 22 * zoom
        card_bot = card_top + row_gap + 4 * zoom
        # clamp
        card_top = max(0, card_top)
        boxes.append(
            {
                "pix": (int(col_left), int(card_top), int(col_right), int(min(card_bot, page.rect.height * zoom))),
                "photo_pdf": b,
                "col": col_idx,
                "y": b[1],
                "row": round(b[1]),
            }
        )
    # Stable reading order: top→bottom rows, left→right columns
    boxes.sort(key=lambda b: (b["row"], b["col"], b["y"]))
    return boxes


def parse_card_text(text: str) -> dict:
    epic = fix_epic(text)
    name_te = parse_name(text)
    rel_type, rel_te = parse_relation(text)
    age = None
    am = AGE_RE.search(text)
    if am:
        age = int(am.group(1))
        if age < 18 or age > 120:
            age = None
    house = ""
    hm = HOUSE_RE.search(text)
    if hm:
        house = clean_spaces(hm.group(1)).rstrip(".:")
    serial = None
    sm = re.search(r"[\[\(]\s*(\d{1,4})\s*[\]\)]", text)
    if sm:
        serial = int(sm.group(1))
    return {
        "epic": epic,
        "nameTe": name_te,
        "name": to_english(name_te),
        "relationType": rel_type,
        "relationNameTe": rel_te,
        "relationName": to_english(rel_te),
        "age": age,
        "gender": parse_gender(text),
        "house": house,
        "serial": serial,
        "ocrText": text,
    }


def process_page(pdf_path: Path, page_index: int, ward: int) -> list[dict]:
    doc = fitz.open(pdf_path)
    page = doc[page_index]
    boxes = card_boxes_for_page(page, ZOOM)
    if not boxes:
        doc.close()
        return []
    pix = page.get_pixmap(matrix=fitz.Matrix(ZOOM, ZOOM), alpha=False)
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    rows = []
    PHOTO_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=str(DATA_PDF)) as td:
        td_path = Path(td)
        for bi, box in enumerate(boxes):
            x0, y0, x1, y1 = box["pix"]
            x0 = max(0, x0)
            y0 = max(0, y0)
            x1 = min(img.width, x1)
            y1 = min(img.height, y1)
            if x1 - x0 < 40 or y1 - y0 < 40:
                continue
            card = img.crop((x0, y0, x1, y1))
            jpg = td_path / f"c{bi}.jpg"
            card.save(jpg, quality=80, optimize=True)
            text = run_tesseract(jpg)
            parsed = parse_card_text(text)
            # Retry EPIC only when first pass missed (eng whitelist on bottom strip)
            if not parsed["epic"]:
                strip = card.crop((0, int(card.height * 0.55), card.width, card.height))
                sj = td_path / f"e{bi}.jpg"
                strip.save(sj, quality=85)
                try:
                    epic_raw = subprocess.check_output(
                        [
                            str(TESSERACT),
                            str(sj),
                            "stdout",
                            "-l",
                            "eng",
                            "--oem",
                            "1",
                            "--psm",
                            "7",
                            "-c",
                            "tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
                        ],
                        stderr=subprocess.DEVNULL,
                        timeout=20,
                    ).decode("utf-8", errors="ignore")
                except Exception:
                    epic_raw = ""
                epic2 = fix_epic(epic_raw)
                if epic2:
                    parsed["epic"] = epic2

            photo_path = ""
            epic = parsed["epic"]
            if epic:
                # Crop photo from already-rendered page (no second PDF render)
                pb = box["photo_pdf"]
                px0, py0, px1, py1 = [int(v * ZOOM) for v in pb]
                pad = int(2 * ZOOM)
                photo = img.crop(
                    (
                        max(0, px0 - pad),
                        max(0, py0 - pad),
                        min(img.width, px1 + pad),
                        min(img.height, py1 + pad),
                    )
                )
                dest = PHOTO_DIR / f"{epic}.jpg"
                photo.save(dest, quality=85, optimize=True)
                photo_path = f"/photos/{epic}.jpg"

            rows.append(
                {
                    **parsed,
                    "ward": ward,
                    "page": page_index + 1,
                    "photo": photo_path,
                    "pdf": pdf_path.name,
                    "cardIndex": bi,
                    "col": box.get("col"),
                    "y": box.get("y"),
                }
            )
    doc.close()
    return rows


def ward_from_name(path: Path) -> int:
    m = re.search(r"WARD\s*(\d+)", path.name, re.I)
    return int(m.group(1)) if m else 0


def build_voter(row: dict, serial: int) -> dict:
    ward = row["ward"]
    return {
        "serial": serial,
        "epic": row.get("epic") or "",
        "name": row.get("name") or "",
        "nameTe": row.get("nameTe") or "",
        "relationType": row.get("relationType") or "",
        "relationName": row.get("relationName") or "",
        "relationNameTe": row.get("relationNameTe") or "",
        "house": row.get("house") or "",
        "age": row.get("age"),
        "ageBand": age_band(row.get("age")),
        "gender": row.get("gender") or "",
        "ward": ward,
        "part": ward,
        "habitation": PANCHAYAT,
        "habitationTe": "దామలచెరువు",
        "habitationId": 1,
        "section": f"Ward {ward}",
        "sectionName": f"Ward {ward}",
        "sectionNo": str(ward),
        "assemblySerial": "",
        "constituency": ASSEMBLY,
        "constituencyLabel": ASSEMBLY,
        "district": DISTRICT,
        "tehsilMandal": MANDAL,
        "mainTown": PANCHAYAT,
        "panchayat": APP_NAME,
        "yearOfRevision": str(YEAR),
        "typeOfRevision": "GP Elections 2026",
        "page": row.get("page"),
        "phone": "",
        "currentAddress": "",
        "notes": "",
        "voterStatus": "",
        "photo": row.get("photo") or "",
        "pollingStationName": f"Ward {ward}",
    }


def main() -> None:
    if not TESSERACT.exists():
        raise SystemExit(f"tesseract not found at {TESSERACT}")

    pdfs = sorted(DATA_PDF.glob("Damalacheruvu WARD *.pdf"), key=ward_from_name)
    if not pdfs:
        raise SystemExit(f"No Damalacheruvu WARD PDFs in {DATA_PDF}")

    # Backup previous CKP roll once
    if OUT_JSON.exists() and not OUT_BACKUP.exists():
        OUT_BACKUP.write_bytes(OUT_JSON.read_bytes())
        print(f"Backed up previous roll → {OUT_BACKUP}")

    OCR_CACHE.mkdir(parents=True, exist_ok=True)
    PHOTO_DIR.mkdir(parents=True, exist_ok=True)

    jobs = []
    for pdf in pdfs:
        ward = ward_from_name(pdf)
        doc = fitz.open(pdf)
        for pi in range(doc.page_count):
            if list_photos(doc[pi]):
                jobs.append((pdf, pi, ward))
        doc.close()

    print(f"OCR jobs: {len(jobs)} pages across {len(pdfs)} wards")
    all_rows: list[dict] = []
    done = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(process_page, pdf, pi, ward): (pdf, pi, ward) for pdf, pi, ward in jobs}
        for fut in as_completed(futs):
            pdf, pi, ward = futs[fut]
            try:
                rows = fut.result()
            except Exception as e:
                print(f"FAIL {pdf.name} p{pi+1}: {e}")
                rows = []
            all_rows.extend(rows)
            done += 1
            if done % 5 == 0 or done == len(jobs):
                print(f"  [{done}/{len(jobs)}] ward={ward} page={pi+1} cards+={len(rows)} total_cards={len(all_rows)}")

    # Deduplicate by epic (prefer rows with name)
    by_epic: dict[str, dict] = {}
    no_epic = []
    for row in all_rows:
        epic = (row.get("epic") or "").upper()
        if not epic:
            no_epic.append(row)
            continue
        prev = by_epic.get(epic)
        if not prev or (row.get("name") and not prev.get("name")):
            by_epic[epic] = row

    voters = []
    serial_n = 0
    for ward in range(1, 17):
        ward_rows = [r for e, r in by_epic.items() if r.get("ward") == ward]
        ward_rows.sort(key=lambda r: (r.get("page") or 0, r.get("y") or 0, r.get("col") or 0, r.get("cardIndex") or 0))
        local = 0
        for row in ward_rows:
            serial_n += 1
            local += 1
            # Prefer OCR serial only when plausible for this ward sequence
            voters.append(build_voter(row, serial_n))

    voters.sort(key=lambda v: (v["ward"] or 0, v["serial"]))

    # Cache raw for debugging
    (OCR_CACHE / "raw_rows.json").write_text(
        json.dumps({"rows": all_rows, "noEpic": len(no_epic), "uniqueEpics": len(by_epic)}, ensure_ascii=False),
        encoding="utf-8",
    )

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
            {
                "id": 1,
                "name": PANCHAYAT,
                "nameTe": "దామలచెరువు",
                "from": 1,
                "to": len(voters),
            }
        ],
        "source": "data/Damalacheruvu WARD *.pdf (OCR)",
        "ocrNoEpicCards": len(no_epic),
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps({"meta": meta, "voters": voters}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # Invalidate latest pointer so UI reloads new roll
    latest = OUT_JSON.parent / "voters_latest.json"
    if latest.exists():
        latest.write_text(json.dumps({"meta": meta, "voters": voters}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(
        f"Wrote {len(voters)} voters → {OUT_JSON}\n"
        f"male={meta['male']} female={meta['female']} photos={meta['photosMapped']} "
        f"missing_name={sum(1 for v in voters if not v['name'])} "
        f"missing_epic={sum(1 for v in voters if not v['epic'])} no_epic_cards={len(no_epic)}"
    )
    if voters:
        print("sample:", json.dumps(voters[0], ensure_ascii=False, indent=2)[:600])


if __name__ == "__main__":
    main()
