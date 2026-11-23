#!/usr/bin/env python3
"""Recover voters whose first OCR pass missed EPIC (≈1655 cards)."""

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
    TESSERACT,
    build_voter,
    card_boxes_for_page,
    list_photos,
    to_english,
)
from reparse_damalacheruvu_ocr import (
    extract_epic,
    parse_age,
    parse_gender,
    parse_house,
    parse_name,
    parse_relation,
    reparse_row,
)

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RAW = DATA / "ocr_cache" / "raw_rows.json"
VOTERS = ROOT / "web" / "public" / "data" / "voters.json"
LATEST = ROOT / "web" / "public" / "data" / "voters_latest.json"
PHOTO = ROOT / "web" / "public" / "photos"
WORKERS = max(6, min(10, os.cpu_count() or 8))
ZOOM = 2.5


def epic_from_strip(img: Image.Image) -> str:
    """OCR bottom portion with eng whitelist for EPIC."""
    h = img.height
    strip = img.crop((0, int(h * 0.45), img.width, h))
    with tempfile.TemporaryDirectory(dir=str(DATA)) as td:
        p = Path(td) / "e.jpg"
        strip.save(p, quality=95)
        try:
            raw = subprocess.check_output(
                [
                    str(TESSERACT),
                    str(p),
                    "stdout",
                    "-l",
                    "eng",
                    "--oem",
                    "1",
                    "--psm",
                    "6",
                    "-c",
                    "tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
                ],
                stderr=subprocess.DEVNULL,
                timeout=30,
            ).decode("utf-8", errors="ignore")
        except Exception:
            raw = ""
    return extract_epic(raw, "")


def full_ocr(img: Image.Image) -> str:
    with tempfile.TemporaryDirectory(dir=str(DATA)) as td:
        p = Path(td) / "c.jpg"
        img.save(p, quality=90)
        try:
            return subprocess.check_output(
                [str(TESSERACT), str(p), "stdout", "-l", "tel+eng", "--oem", "1", "--psm", "6"],
                stderr=subprocess.DEVNULL,
                timeout=45,
            ).decode("utf-8", errors="ignore")
        except Exception:
            return ""


def process(row: dict) -> dict | None:
    pdf = DATA / row["pdf"]
    if not pdf.exists():
        return None
    doc = fitz.open(pdf)
    page = doc[row["page"] - 1]
    boxes = card_boxes_for_page(page, ZOOM)
    idx = int(row.get("cardIndex") or 0)
    if not boxes:
        doc.close()
        return None
    if idx >= len(boxes):
        idx = len(boxes) - 1
    box = boxes[idx]
    pix = page.get_pixmap(matrix=fitz.Matrix(ZOOM, ZOOM), alpha=False)
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    x0, y0, x1, y1 = box["pix"]
    y0 = max(0, y0 - int(20 * ZOOM))
    y1 = min(img.height, y1 + int(8 * ZOOM))
    x0, x1 = max(0, x0), min(img.width, x1)
    card = img.crop((x0, y0, x1, y1))

    epic = epic_from_strip(card)
    text = full_ocr(card)
    if not epic:
        epic = extract_epic(text, "")
    if not epic or not re.fullmatch(r"[A-Z]{3}\d{7}", epic):
        doc.close()
        return None

    dig = epic[3:]
    if epic.startswith("IAX") and (PHOTO / f"BDG{dig}.jpg").exists():
        epic = f"BDG{dig}"

    # photo
    pb = box["photo_pdf"]
    px0, py0, px1, py1 = [int(v * ZOOM) for v in pb]
    pad = int(2 * ZOOM)
    photo = img.crop((max(0, px0 - pad), max(0, py0 - pad), min(img.width, px1 + pad), min(img.height, py1 + pad)))
    PHOTO.mkdir(parents=True, exist_ok=True)
    dest = PHOTO / f"{epic}.jpg"
    photo.save(dest, quality=85, optimize=True)
    doc.close()

    name_te = parse_name(text) or parse_name(row.get("ocrText") or "")
    rel_type, rel_te = parse_relation(text)
    if not rel_te:
        rel_type, rel_te = parse_relation(row.get("ocrText") or "")
    old = reparse_row(row)
    return {
        "epic": epic,
        "nameTe": name_te or old.get("nameTe") or "",
        "name": to_english(name_te) if name_te else (old.get("name") or ""),
        "relationType": rel_type or old.get("relationType") or "",
        "relationNameTe": rel_te or old.get("relationNameTe") or "",
        "relationName": to_english(rel_te) if rel_te else (old.get("relationName") or ""),
        "age": parse_age(text) or old.get("age"),
        "gender": parse_gender(text) or old.get("gender") or "",
        "house": parse_house(text) or old.get("house") or "",
        "ward": row.get("ward"),
        "page": row.get("page"),
        "photo": f"/photos/{epic}.jpg",
        "pdf": row.get("pdf"),
        "cardIndex": row.get("cardIndex"),
        "col": row.get("col"),
        "y": row.get("y"),
    }


def main() -> None:
    raw = json.loads(RAW.read_text(encoding="utf-8")).get("rows", [])
    data = json.loads(VOTERS.read_text(encoding="utf-8"))
    existing = {v["epic"].upper() for v in data["voters"]}
    existing_digits = {e[3:] for e in existing if len(e) == 10}

    jobs = []
    for r in raw:
        e = extract_epic(r.get("ocrText") or "", r.get("epic") or "")
        if e and re.fullmatch(r"[A-Z]{3}\d{7}", e):
            continue
        if r.get("pdf") and r.get("page"):
            jobs.append(r)

    print(f"Recover jobs: {len(jobs)}")
    recovered = []
    done = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(process, j): j for j in jobs}
        for fut in as_completed(futs):
            done += 1
            try:
                row = fut.result()
            except Exception:
                row = None
            if row and row["epic"][3:] not in existing_digits and row["epic"] not in existing:
                recovered.append(row)
                existing.add(row["epic"])
                existing_digits.add(row["epic"][3:])
            if done % 100 == 0 or done == len(jobs):
                print(f"  [{done}/{len(jobs)}] recovered={len(recovered)}")

    # append new voters with continuing serials
    serial = max((v.get("serial") or 0) for v in data["voters"]) if data["voters"] else 0
    for row in sorted(recovered, key=lambda r: (r.get("ward") or 0, r.get("page") or 0, r.get("cardIndex") or 0)):
        serial += 1
        data["voters"].append(build_voter(row, serial))

    # also fill house/name/rel on existing from improved parse of raw where empty
    by_dig = {}
    for r in raw:
        rr = reparse_row(r)
        e = (rr.get("epic") or "").upper()
        if len(e) == 10:
            by_dig.setdefault(e[3:], []).append(rr)

    filled = {"house": 0, "name": 0, "rel": 0}
    for v in data["voters"]:
        dig = v["epic"][3:]
        for a in by_dig.get(dig, []):
            if not v.get("house") and a.get("house"):
                v["house"] = a["house"]
                filled["house"] += 1
            if not v.get("name") and a.get("name"):
                v["name"] = a["name"]
                v["nameTe"] = a.get("nameTe") or ""
                filled["name"] += 1
            if not v.get("relationName") and a.get("relationName"):
                v["relationName"] = a["relationName"]
                v["relationNameTe"] = a.get("relationNameTe") or ""
                v["relationType"] = a.get("relationType") or ""
                filled["rel"] += 1

    vs = data["voters"]
    data["meta"]["total"] = len(vs)
    data["meta"]["male"] = sum(1 for v in vs if v.get("gender") == "Male")
    data["meta"]["female"] = sum(1 for v in vs if v.get("gender") == "Female")
    data["meta"]["photosMapped"] = sum(1 for v in vs if v.get("photo"))
    data["meta"]["wards"] = sorted({v["ward"] for v in vs if v.get("ward")})
    data["meta"]["recovery"] = {
        "newVoters": len(recovered),
        "filledFromCache": filled,
        "missingName": sum(1 for v in vs if not v.get("name")),
        "missingHouse": sum(1 for v in vs if not v.get("house")),
        "missingRelation": sum(1 for v in vs if not v.get("relationName")),
    }
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    VOTERS.write_text(text, encoding="utf-8")
    LATEST.write_text(text, encoding="utf-8")
    print(
        f"total={len(vs)} new={len(recovered)} "
        f"miss_name={data['meta']['recovery']['missingName']} "
        f"miss_house={data['meta']['recovery']['missingHouse']} "
        f"miss_rel={data['meta']['recovery']['missingRelation']}"
    )


if __name__ == "__main__":
    main()
