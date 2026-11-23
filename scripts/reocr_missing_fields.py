#!/usr/bin/env python3
"""Re-OCR only cards missing name and/or relation, with taller crops."""

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
    ZOOM,
    card_boxes_for_page,
    list_photos,
    run_tesseract,
    to_english,
    ward_from_name,
)
from reparse_damalacheruvu_ocr import (
    extract_epic,
    parse_age,
    parse_gender,
    parse_house,
    parse_name,
    parse_relation,
)

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RAW = DATA / "ocr_cache" / "raw_rows.json"
VOTERS = ROOT / "web" / "public" / "data" / "voters.json"
LATEST = ROOT / "web" / "public" / "data" / "voters_latest.json"
WORKERS = max(6, min(10, os.cpu_count() or 8))
REZOOM = 2.5


def ocr_card_image(card: Image.Image) -> str:
    with tempfile.TemporaryDirectory(dir=str(DATA)) as td:
        p = Path(td) / "c.jpg"
        card.save(p, quality=90)
        return run_tesseract(p, lang="tel+eng", psm=6)


def process_job(job: dict) -> dict | None:
    pdf = DATA / job["pdf"]
    if not pdf.exists():
        return None
    doc = fitz.open(pdf)
    page = doc[job["page"] - 1]
    # taller crop: more space above photo for name line
    photos = list_photos(page)
    if not photos:
        doc.close()
        return None
    # match by cardIndex if possible
    boxes = card_boxes_for_page(page, REZOOM)
    # override tops to include more header
    pix = page.get_pixmap(matrix=fitz.Matrix(REZOOM, REZOOM), alpha=False)
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    idx = job.get("cardIndex", 0)
    if idx >= len(boxes):
        idx = min(idx, len(boxes) - 1)
    if idx < 0 or not boxes:
        doc.close()
        return None
    box = boxes[idx]
    x0, y0, x1, y1 = box["pix"]
    # expand upward for name
    y0 = max(0, y0 - int(18 * REZOOM))
    y1 = min(img.height, y1 + int(6 * REZOOM))
    x0 = max(0, x0)
    x1 = min(img.width, x1)
    card = img.crop((x0, y0, x1, y1))
    text = ocr_card_image(card)
    doc.close()
    name_te = parse_name(text)
    rel_type, rel_te = parse_relation(text)
    return {
        "epicKey": job["epicKey"],
        "nameTe": name_te,
        "name": to_english(name_te) if name_te else "",
        "relationType": rel_type,
        "relationNameTe": rel_te,
        "relationName": to_english(rel_te) if rel_te else "",
        "age": parse_age(text),
        "gender": parse_gender(text),
        "house": parse_house(text),
        "ocrText": text,
    }


def main() -> None:
    data = json.loads(VOTERS.read_text(encoding="utf-8"))
    voters = data["voters"]
    raw_rows = json.loads(RAW.read_text(encoding="utf-8")).get("rows", [])

    # map epic digits → best raw row with pdf/page/cardIndex
    by_dig: dict[str, dict] = {}
    for r in raw_rows:
        epic = extract_epic(r.get("ocrText") or "", r.get("epic") or "")
        if len(epic) != 10:
            continue
        dig = epic[3:]
        if dig not in by_dig or (r.get("ocrText") and len(r.get("ocrText") or "") > len(by_dig[dig].get("ocrText") or "")):
            by_dig[dig] = {**r, "epicKey": epic}

    jobs = []
    for v in voters:
        need_name = not (v.get("name") or "").strip()
        need_rel = not (v.get("relationName") or "").strip()
        if not need_name and not need_rel:
            continue
        dig = v["epic"][3:]
        src = by_dig.get(dig)
        if not src or not src.get("pdf"):
            continue
        jobs.append(
            {
                "epicKey": v["epic"],
                "pdf": src["pdf"],
                "page": src.get("page") or 1,
                "cardIndex": src.get("cardIndex") or 0,
                "need_name": need_name,
                "need_rel": need_rel,
            }
        )

    print(f"Re-OCR jobs: {len(jobs)} (missing name/relation)")
    results = []
    done = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(process_job, j): j for j in jobs}
        for fut in as_completed(futs):
            done += 1
            try:
                r = fut.result()
            except Exception as e:
                r = None
                if done % 50 == 0:
                    print(f"  fail {e}")
            if r:
                results.append(r)
            if done % 100 == 0 or done == len(jobs):
                print(f"  [{done}/{len(jobs)}] got={len(results)}")

    by_key = {r["epicKey"]: r for r in results}
    # also index by digits
    by_digits = {k[3:]: r for k, r in by_key.items() if len(k) == 10}

    filled_name = filled_rel = 0
    for v in voters:
        r = by_key.get(v["epic"]) or by_digits.get(v["epic"][3:])
        if not r:
            continue
        if not v.get("name") and r.get("name"):
            v["name"] = r["name"]
            v["nameTe"] = r.get("nameTe") or ""
            filled_name += 1
        if not v.get("relationName") and r.get("relationName"):
            v["relationName"] = r["relationName"]
            v["relationNameTe"] = r.get("relationNameTe") or ""
            v["relationType"] = r.get("relationType") or ""
            filled_rel += 1
        if not v.get("age") and r.get("age"):
            v["age"] = r["age"]
        if not v.get("house") and r.get("house"):
            v["house"] = r["house"]
        if not v.get("gender") and r.get("gender"):
            v["gender"] = r["gender"]

    data["meta"]["male"] = sum(1 for v in voters if v.get("gender") == "Male")
    data["meta"]["female"] = sum(1 for v in voters if v.get("gender") == "Female")
    data["meta"]["nameFillPass"] = {
        "jobs": len(jobs),
        "filledName": filled_name,
        "filledRelation": filled_rel,
        "stillMissingName": sum(1 for v in voters if not v.get("name")),
        "stillMissingRelation": sum(1 for v in voters if not v.get("relationName")),
    }
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    VOTERS.write_text(text, encoding="utf-8")
    LATEST.write_text(text, encoding="utf-8")
    print(
        f"filled_name={filled_name} filled_rel={filled_rel} "
        f"still_missing_name={data['meta']['nameFillPass']['stillMissingName']} "
        f"still_missing_rel={data['meta']['nameFillPass']['stillMissingRelation']}"
    )


if __name__ == "__main__":
    main()
