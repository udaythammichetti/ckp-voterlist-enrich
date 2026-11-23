#!/usr/bin/env python3
"""Rebuild Damalacheruvu roll in strict PDF reading order.

Every photo-card becomes one voter slot (no dropping). Missing EPICs are
re-OCR'd in place so later cards do not slide up (fixes S.No 2 = Sadik).
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
from PIL import Image

from extract_damalacheruvu_ocr import (
    APP_NAME,
    ASSEMBLY,
    DISTRICT,
    MANDAL,
    PANCHAYAT,
    TESSERACT,
    YEAR,
    age_band,
    build_voter,
    card_boxes_for_page,
    list_photos,
    to_english,
    ward_from_name,
)
from reparse_damalacheruvu_ocr import (
    extract_epic,
    extract_pii_by_layout,
    infer_gender,
    looks_like_garbage_name,
    merge_pii,
    parse_age,
    parse_gender,
    parse_house,
    parse_name,
    parse_relation,
    reparse_row,
    resolve_neighbor_conflicts,
)

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RAW = DATA / "ocr_cache" / "raw_rows.json"
OUT = ROOT / "web" / "public" / "data" / "voters.json"
LATEST = ROOT / "web" / "public" / "data" / "voters_latest.json"
PHOTO = ROOT / "web" / "public" / "photos"
WORKERS = max(6, min(10, os.cpu_count() or 8))
ZOOM = 2.5

# Limit for testing: set via env WARDS=1,2 (default all)
def selected_wards() -> set[int] | None:
    raw = os.environ.get("WARDS", "").strip()
    if not raw:
        return None
    return {int(x) for x in re.split(r"[,\s]+", raw) if x.isdigit()}


def ocr_card(card: Image.Image) -> tuple[str, str]:
    with tempfile.TemporaryDirectory(dir=str(DATA)) as td:
        td = Path(td)
        full = td / "c.jpg"
        strip = td / "e.jpg"
        card.save(full, quality=90)
        h = card.height
        card.crop((0, int(h * 0.48), card.width, h)).save(strip, quality=95)
        try:
            text = subprocess.check_output(
                [str(TESSERACT), str(full), "stdout", "-l", "tel+eng", "--oem", "1", "--psm", "6"],
                stderr=subprocess.DEVNULL,
                timeout=45,
            ).decode("utf-8", errors="ignore")
        except Exception:
            text = ""
        try:
            et = subprocess.check_output(
                [
                    str(TESSERACT),
                    str(strip),
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
                timeout=30,
            ).decode("utf-8", errors="ignore")
        except Exception:
            et = ""
    epic = extract_epic(et, "") or extract_epic(text, "")
    return epic, text


def parse_printed_serial(text: str) -> int | None:
    """Read the bracketed roll serial printed on the card header (1..9000)."""
    cands: list[int] = []
    for pat in (
        r"[\[\(]\s*(\d{3,4})\s*[\]\)]",
        r"వ\.?\s*సం\.?\s*[\[\(]?\s*(\d{3,4})",
        r"ఓ\.?\s*జా\.?\s*వ\.?\s*సం\.?\s*[\[\(]?\s*(\d{3,4})",
    ):
        for m in re.finditer(pat, text or ""):
            n = int(m.group(1))
            if 1 <= n <= 9000:
                cands.append(n)
    if not cands:
        return None
    # Prefer 4-digit serials (full roll numbers); last match is usually the card's own.
    four = [n for n in cands if n >= 1000]
    return four[-1] if four else cands[-1]


def _te_len(s: str) -> int:
    return len(re.findall(r"[\u0C00-\u0C7F]", s or ""))


def fields_from_text(text: str, epic: str, fallback: dict | None = None) -> dict:
    fb = fallback or {}
    gender = parse_gender(text) or fb.get("gender") or ""
    labeled = {
        "epic": epic,
        "nameTe": parse_name(text) or "",
        "relationType": "",
        "relationNameTe": "",
        "age": parse_age(text),
        "gender": gender,
        "house": parse_house(text) or "",
    }
    rel_type, rel_te = parse_relation(text, voter_gender=gender)
    gender = infer_gender(text, rel_type, rel_te) or gender
    labeled["gender"] = gender
    labeled["relationType"], labeled["relationNameTe"] = rel_type, rel_te
    layout = extract_pii_by_layout(text)
    merged = merge_pii(labeled, layout)

    name_te = merged.get("nameTe") or ""
    fb_name = fb.get("nameTe") or ""
    if fb_name and (_te_len(fb_name) > _te_len(name_te) + 2 or not name_te):
        if not looks_like_garbage_name(fb_name):
            name_te = fb_name

    rel_te = merged.get("relationNameTe") or ""
    rel_type = merged.get("relationType") or ""
    if not rel_te:
        rel_type, rel_te = fb.get("relationType") or "", fb.get("relationNameTe") or ""
    elif fb.get("relationNameTe") and _te_len(fb.get("relationNameTe") or "") > _te_len(rel_te) + 2:
        rel_te = fb.get("relationNameTe") or rel_te
        rel_type = fb.get("relationType") or rel_type

    if rel_te and name_te and (
        rel_te.strip() == name_te.strip()
        or to_english(rel_te).strip().lower() == to_english(name_te).strip().lower()
    ):
        rel_type, rel_te = "", ""

    house = merged.get("house") or fb.get("house") or ""
    age = merged.get("age") if merged.get("age") is not None else fb.get("age")
    gender = (
        merged.get("gender")
        or gender
        or infer_gender(text, rel_type, rel_te)
        or fb.get("gender")
        or ""
    )

    return {
        "epic": epic,
        "nameTe": name_te,
        "name": to_english(name_te) if name_te else (fb.get("name") or ""),
        "relationType": rel_type,
        "relationNameTe": rel_te,
        "relationName": to_english(rel_te) if rel_te else (fb.get("relationName") or ""),
        "age": age,
        "gender": gender,
        "house": house,
        "truncatedCard": bool(merged.get("truncatedCard")),
    }


def main() -> None:
    raw_rows = json.loads(RAW.read_text(encoding="utf-8")).get("rows", []) if RAW.exists() else []
    # index cache by ward/page/cardIndex
    cache: dict[tuple[int, int, int], dict] = {}
    for r in raw_rows:
        key = (int(r.get("ward") or 0), int(r.get("page") or 0), int(r.get("cardIndex") or 0))
        cache[key] = r

    pdfs = sorted(DATA.glob("Damalacheruvu WARD *.pdf"), key=ward_from_name)
    wards_filter = selected_wards()
    if wards_filter:
        pdfs = [p for p in pdfs if ward_from_name(p) in wards_filter]
        print(f"TEST MODE: only wards {sorted(wards_filter)} → {len(pdfs)} PDFs", flush=True)
    slots: list[dict] = []  # positional slots before epic fill

    for pdf in pdfs:
        ward = ward_from_name(pdf)
        doc = fitz.open(pdf)
        for pi in range(doc.page_count):
            page = doc[pi]
            if not list_photos(page):
                continue
            boxes = card_boxes_for_page(page, ZOOM)
            for idx, box in enumerate(boxes):
                slots.append(
                    {
                        "ward": ward,
                        "page": pi + 1,
                        "cardIndex": idx,
                        "col": box.get("col"),
                        "y": box.get("y"),
                        "photo_pdf": box["photo_pdf"],
                        "pix": box["pix"],
                        "pdf": pdf.name,
                        "pdf_path": str(pdf),
                        "page_index": pi,
                    }
                )
        doc.close()

    print(f"positional slots from PDFs: {len(slots)}", flush=True)

    # Decide which need fresh OCR (no usable epic in cache)
    # FORCE_OCR=1 → re-OCR every card
    # REOCR_MISSING=1 → also re-OCR cards missing name or house after reparse
    force_ocr = os.environ.get("FORCE_OCR", "").strip() in {"1", "true", "yes"}
    reocr_missing = os.environ.get("REOCR_MISSING", "").strip() in {"1", "true", "yes"}
    need_ocr = []
    prepared = []
    for slot in slots:
        key = (slot["ward"], slot["page"], slot["cardIndex"])
        raw = cache.get(key)
        fb = reparse_row(raw) if raw else {}
        epic = (fb.get("epic") or "").upper()
        if (not force_ocr) and epic and re.fullmatch(r"[A-Z]{3}\d{7}", epic):
            dig = epic[3:]
            if epic.startswith("IAX") and (PHOTO / f"BDG{dig}.jpg").exists():
                epic = f"BDG{dig}"
            # Re-apply improved parsers on cached text
            fields = fields_from_text(raw.get("ocrText") or "", epic, fb)
            bad_name = looks_like_garbage_name(fields.get("nameTe") or fields.get("name") or "")
            missing_core = (
                (not fields.get("nameTe"))
                or (not fields.get("house"))
                or (not fields.get("relationNameTe"))
                or (fields.get("age") is None)
                or bad_name
            )
            if reocr_missing and missing_core:
                need_ocr.append(slot)
            else:
                prepared.append({**slot, **fields, "fromCache": True, "ocrText": raw.get("ocrText") or ""})
        else:
            need_ocr.append(slot)

    print(
        f"from cache with EPIC: {len(prepared)}; need OCR: {len(need_ocr)}"
        + (" (FORCE_OCR)" if force_ocr else "")
        + (" (REOCR_MISSING)" if reocr_missing and not force_ocr else ""),
        flush=True,
    )

    def job(slot: dict) -> dict:
        doc = fitz.open(slot["pdf_path"])
        page = doc[slot["page_index"]]
        pix = page.get_pixmap(matrix=fitz.Matrix(ZOOM, ZOOM), alpha=False)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        x0, y0, x1, y1 = slot["pix"]
        # Inset left serial gutter; for mid-page rows inset top to avoid previous-row bleed.
        # Top-of-page cards (small y0): expand upward so voter-name line is not clipped.
        if y0 < int(40 * ZOOM):
            y0 = max(0, y0 - int(8 * ZOOM))
        else:
            y0 = max(0, y0 + int(2 * ZOOM))
        y1 = min(img.height, y1 - int(2 * ZOOM))
        x0, x1 = max(0, x0 + int(8 * ZOOM)), min(img.width, x1 - int(4 * ZOOM))
        if x1 <= x0 + 20 or y1 <= y0 + 20:
            x0, y0, x1, y1 = slot["pix"]
        card = img.crop((x0, y0, x1, y1))
        # Also OCR text strip left of photo (name/relation often clearer there)
        pb = slot["photo_pdf"]
        px0, py0, px1, py1 = [int(v * ZOOM) for v in pb]
        strip = img.crop(
            (
                max(0, x0),
                max(0, py0 - int(28 * ZOOM)),
                max(x0 + 10, px0 - int(2 * ZOOM)),
                min(img.height, py1 + int(8 * ZOOM)),
            )
        )
        epic, text = ocr_card(card)
        if strip.width > 30 and strip.height > 30:
            try:
                _, strip_text = ocr_card(strip)
            except Exception:
                strip_text = ""
            if strip_text:
                text = (strip_text + "\n" + text).strip()
                if not epic:
                    epic = extract_epic(strip_text, "") or epic
        # save photo
        pb = slot["photo_pdf"]
        px0, py0, px1, py1 = [int(v * ZOOM) for v in pb]
        pad = int(2 * ZOOM)
        photo = img.crop(
            (max(0, px0 - pad), max(0, py0 - pad), min(img.width, px1 + pad), min(img.height, py1 + pad))
        )
        doc.close()
        key = (slot["ward"], slot["page"], slot["cardIndex"])
        raw = cache.get(key)
        fb = reparse_row(raw) if raw else {}
        if not epic:
            # stable placeholder so slot is never dropped
            epic = f"UNK{slot['ward']:02d}{slot['page']:02d}{slot['cardIndex']:02d}{slot['ward']:01d}"[:10]
            # ensure 3 letters + 7 digits shape
            epic = f"UNK{slot['ward']:02d}{slot['page']:02d}{slot['cardIndex']:03d}"
            if not re.fullmatch(r"[A-Z]{3}\d{7}", epic):
                epic = f"TMP{slot['ward']:01d}{slot['page']:02d}{slot['cardIndex']:04d}"[:10]
                epic = (epic + "0000000000")[:10]
                # force pattern
                epic = f"TMP{int(slot['ward'])%10}{slot['page']:02d}{slot['cardIndex']:04d}"
        if epic.startswith("IAX"):
            dig = epic[3:]
            if (PHOTO / f"BDG{dig}.jpg").exists():
                epic = f"BDG{dig}"
        PHOTO.mkdir(parents=True, exist_ok=True)
        if re.fullmatch(r"[A-Z]{3}\d{7}", epic):
            photo.save(PHOTO / f"{epic}.jpg", quality=85, optimize=True)
        fields = fields_from_text(text, epic, fb)
        return {
            **slot,
            **fields,
            "ocrText": text,
            "fromCache": False,
            "photo": f"/photos/{epic}.jpg" if re.fullmatch(r"[A-Z]{3}\d{7}", epic) else "",
        }

    done = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(job, s): s for s in need_ocr}
        for fut in as_completed(futs):
            done += 1
            try:
                prepared.append(fut.result())
            except Exception as e:
                s = futs[fut]
                # still keep slot
                epic = f"TMP{s['ward']%10}{s['page']:02d}{s['cardIndex']:04d}"
                prepared.append({**s, "epic": epic, "name": "", "nameTe": "", "relationType": "", "relationName": "", "relationNameTe": "", "age": None, "gender": "", "house": "", "photo": "", "fromCache": False})
            if done % 100 == 0 or done == len(need_ocr):
                print(f"  OCR [{done}/{len(need_ocr)}]", flush=True)

    # Sort back to PDF order
    prepared.sort(key=lambda r: (r["ward"], r["page"], r.get("y") or 0, r.get("col") or 0, r["cardIndex"]))

    # Clear previous/next card OCR bleed conflicts before writing voters
    prepared = resolve_neighbor_conflicts(prepared)

    # Deduplicate epics: keep first occurrence in reading order; rename later dupes to keep slots
    seen: set[str] = set()
    voters = []
    # Collect printed serials first to detect missing-card drift (assigned = printed-1).
    printed_list: list[int | None] = []
    for idx, row in enumerate(prepared):
        p = parse_printed_serial(row.get("ocrText") or "")
        if p is not None and (abs(p - (idx + 1)) <= 3 or abs(p - (idx + 2)) <= 3):
            printed_list.append(p)
        else:
            printed_list.append(None)

    split = None
    for idx, p in enumerate(printed_list):
        if p == idx + 2:
            split = idx
            break
    if split is None:
        split = 0

    for idx, row in enumerate(prepared):
        epic = (row.get("epic") or "").upper()
        if not re.fullmatch(r"[A-Z]{3}\d{7}", epic):
            epic = f"TMP{row['ward']%10}{row['page']:02d}{row['cardIndex']:04d}"
        if epic in seen:
            # keep the person/slot visible with unique key
            epic = f"DUP{idx+1:07d}"[:10]
            if not re.fullmatch(r"[A-Z]{3}\d{7}", epic):
                epic = f"DUP{idx+1:07d}"
        seen.add(epic)
        row["epic"] = epic
        if not row.get("photo") and (PHOTO / f"{epic}.jpg").exists():
            row["photo"] = f"/photos/{epic}.jpg"
        # Prefer printed serial; else positional with +1 after missing-card split.
        printed = printed_list[idx]
        if printed is not None:
            serial = printed
        else:
            serial = idx + 1 if idx < split else idx + 2
        v = build_voter(row, serial)
        v["page"] = row.get("page")
        v["notes"] = "" if row.get("fromCache") or not epic.startswith(("TMP", "UNK", "DUP")) else "EPIC uncertain — verify"
        voters.append(v)

    # Resolve duplicate serials while keeping reading order
    used_serials: set[int] = set()
    for v in voters:
        s = int(v.get("serial") or 0)
        while s in used_serials:
            s += 1
        v["serial"] = s
        used_serials.add(s)
    voters.sort(key=lambda v: (v.get("serial") or 0, v.get("ward") or 0, v.get("page") or 0))

    meta = {
        "panchayat": APP_NAME,
        "appName": APP_NAME,
        "mainTown": PANCHAYAT,
        "district": DISTRICT,
        "mandal": MANDAL,
        "assembly": ASSEMBLY,
        "year": YEAR,
        "total": len(voters),
        "male": sum(1 for v in voters if v.get("gender") == "Male"),
        "female": sum(1 for v in voters if v.get("gender") == "Female"),
        "wards": sorted({v["ward"] for v in voters if v.get("ward")}),
        "photosMapped": sum(1 for v in voters if v.get("photo")),
        "habitations": [{"id": 1, "name": PANCHAYAT, "nameTe": "దామలచెరువు", "from": 1, "to": len(voters)}],
        "source": "positional rebuild from Damalacheruvu WARD PDFs",
        "officialTarget": 8009,
        "missingName": sum(1 for v in voters if not (v.get("name") or v.get("nameTe"))),
        "missingHouse": sum(1 for v in voters if not v.get("house")),
        "missingRelation": sum(
            1 for v in voters if not (v.get("relationName") or v.get("relationNameTe"))
        ),
        "missingAge": sum(1 for v in voters if v.get("age") is None),
        "missingGender": sum(1 for v in voters if not v.get("gender")),
        "placeholderEpics": sum(
            1 for v in voters if str(v.get("epic", "")).startswith(("TMP", "UNK", "DUP"))
        ),
    }
    payload = {"meta": meta, "voters": voters}
    text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    OUT.write_text(text, encoding="utf-8")
    LATEST.write_text(text, encoding="utf-8")

    # Refresh OCR cache for freshly OCR'd slots so next reparse sees new text
    updated = 0
    for row in prepared:
        if row.get("fromCache") or not row.get("ocrText"):
            continue
        key = (row["ward"], row["page"], row["cardIndex"])
        prev = cache.get(key) or {}
        cache[key] = {
            **prev,
            "ward": row["ward"],
            "page": row["page"],
            "cardIndex": row["cardIndex"],
            "epic": row.get("epic") or prev.get("epic") or "",
            "ocrText": row["ocrText"],
            "pdf": Path(row.get("pdf_path") or prev.get("pdf") or "").name,
        }
        updated += 1
    if updated:
        RAW.parent.mkdir(parents=True, exist_ok=True)
        # keep other wards' rows
        all_rows = []
        kept = set()
        for k, r in cache.items():
            all_rows.append(r)
            kept.add(k)
        if RAW.exists():
            for r in json.loads(RAW.read_text(encoding="utf-8")).get("rows", []):
                key = (int(r.get("ward") or 0), int(r.get("page") or 0), int(r.get("cardIndex") or 0))
                if key not in kept:
                    all_rows.append(r)
        RAW.write_text(json.dumps({"rows": all_rows}, ensure_ascii=False), encoding="utf-8")
        print(f"Updated OCR cache for {updated} cards", flush=True)

    # show ward1 first 8 for verification
    w1 = [v for v in voters if v["ward"] == 1][:8]
    print(f"Wrote {len(voters)} voters (target 8009)")
    print(
        f"missing name={meta['missingName']} house={meta['missingHouse']} "
        f"rel={meta['missingRelation']} age={meta['missingAge']} "
        f"gender={meta['missingGender']} placeholders={meta['placeholderEpics']}"
    )
    for v in w1:
        print(
            f"  S{v['serial']} {v['epic']} {v.get('name')} | "
            f"{v.get('relationType')}:{v.get('relationName')} | house={v.get('house')}"
        )


if __name__ == "__main__":
    main()
