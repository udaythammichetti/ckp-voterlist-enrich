#!/usr/bin/env python3
"""Fix roll serial numbers + photo crops from Damalacheruvu ward PDFs.

Problems this addresses:
  1) Positional serials drift vs printed PDF serials (often off by -1 after a
     missing photo-card early in the roll).
  2) Photos remapped by EPIC recovery can point at the wrong face.

Strategy:
  - Rebuild card slots in stable reading order (row, col) from each PDF.
  - Align existing voters.json rows 1:1 with those slots (same order as rebuild).
  - Assign serials from printed OCR anchors; fill gaps; skip one serial where
     the roll is short vs official 8009.
  - Re-crop every photo from that slot's photo bbox and save as {epic}.jpg.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

import fitz
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from extract_damalacheruvu_ocr import card_boxes_for_page, list_photos  # noqa: E402
from rebuild_positional_roll import parse_printed_serial  # noqa: E402

ZOOM = 2.5
DATA = ROOT / "data"
OUT = ROOT / "web" / "public" / "data" / "voters.json"
LATEST = ROOT / "web" / "public" / "data" / "voters_latest.json"
PHOTO = ROOT / "web" / "public" / "photos"
SLOTS_CACHE = DATA / "_debug" / "slots_index.json"
RAW = DATA / "ocr_cache" / "raw_rows.json"


def build_slots(force: bool = False) -> list[dict]:
    if SLOTS_CACHE.exists() and not force:
        slots = json.loads(SLOTS_CACHE.read_text(encoding="utf-8"))
        print(f"loaded slots cache: {len(slots)}", flush=True)
        return slots

    slots: list[dict] = []
    for ward in range(1, 17):
        pdf = DATA / f"Damalacheruvu WARD {ward}.pdf"
        if not pdf.exists():
            continue
        doc = fitz.open(pdf)
        for pi in range(doc.page_count):
            page = doc[pi]
            if not list_photos(page):
                continue
            for idx, box in enumerate(card_boxes_for_page(page, ZOOM)):
                slots.append(
                    {
                        "ward": ward,
                        "page": pi + 1,
                        "cardIndex": idx,
                        "page_index": pi,
                        "pdf": str(pdf),
                        "photo_pdf": list(box["photo_pdf"]),
                        "col": box.get("col"),
                        "y": box.get("y"),
                        "row": box.get("row"),
                    }
                )
        doc.close()
        print(f"  ward {ward}: slots so far {len(slots)}", flush=True)

    SLOTS_CACHE.parent.mkdir(parents=True, exist_ok=True)
    SLOTS_CACHE.write_text(json.dumps(slots), encoding="utf-8")
    print(f"built slots: {len(slots)}", flush=True)
    return slots


def reliable_printed(text: str, index: int) -> int | None:
    """Printed serial if it is near the expected positional index."""
    p = parse_printed_serial(text or "")
    if p is None:
        return None
    # Allow current index, index+1 (missing-card drift), or small OCR noise.
    if abs(p - (index + 1)) <= 3 or abs(p - (index + 2)) <= 3:
        return p
    return None


def assign_serials(voters: list[dict], slots: list[dict], raw_by: dict) -> tuple[list[int], int]:
    """Return new serial list + split index used for missing-card offset."""
    n = len(voters)
    anchors: list[tuple[int, int]] = []
    for i in range(n):
        key = (slots[i]["ward"], slots[i]["page"], slots[i]["cardIndex"])
        text = (raw_by.get(key) or {}).get("ocrText") or voters[i].get("ocrText") or ""
        p = reliable_printed(text, i)
        if p is not None:
            anchors.append((i, p))

    # Detect first durable +1 offset (printed == index+2)
    split = None
    for i, p in anchors:
        if p == (i + 2):
            # confirm nearby anchors also prefer +1
            window = [pp - (ii + 1) for ii, pp in anchors if abs(ii - i) <= 20]
            if window and Counter(window).most_common(1)[0][0] == 1:
                split = i
                break
    if split is None:
        # fallback from earlier diagnosis
        split = 1716

    serials = [0] * n
    for i in range(n):
        serials[i] = i + 1 if i < split else i + 2

    # Snap exact anchors when they don't collide
    used = set(serials)
    for i, p in anchors:
        if serials[i] == p:
            continue
        # Only snap if p is free or already this index
        if p not in used or serials[i] == p:
            used.discard(serials[i])
            serials[i] = p
            used.add(p)

    # Final monotonic pass: keep order, bump duplicates forward
    seen: set[int] = set()
    for i in range(n):
        s = serials[i]
        while s in seen:
            s += 1
        serials[i] = s
        seen.add(s)

    return serials, split


def recrop_photos(voters: list[dict], slots: list[dict]) -> int:
    docs: dict[str, fitz.Document] = {}
    updated = 0
    n = len(voters)
    # Cache rendered pages: (pdf, page_index) -> PIL image
    page_imgs: dict[tuple[str, int], Image.Image] = {}

    for i, v in enumerate(voters):
        slot = slots[i]
        pdf = slot["pdf"]
        key = (pdf, slot["page_index"])
        if key not in page_imgs:
            if pdf not in docs:
                docs[pdf] = fitz.open(pdf)
            page = docs[pdf][slot["page_index"]]
            pix = page.get_pixmap(matrix=fitz.Matrix(ZOOM, ZOOM), alpha=False)
            page_imgs[key] = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            # Bound memory: drop older pages when cache grows
            if len(page_imgs) > 12:
                oldest = next(iter(page_imgs))
                if oldest != key:
                    del page_imgs[oldest]

        img = page_imgs[key]
        pb = slot["photo_pdf"]
        px0, py0, px1, py1 = [int(x * ZOOM) for x in pb]
        pad = int(2 * ZOOM)
        photo = img.crop(
            (
                max(0, px0 - pad),
                max(0, py0 - pad),
                min(img.width, px1 + pad),
                min(img.height, py1 + pad),
            )
        )
        epic = str(v.get("epic") or "").upper()
        if not epic:
            continue
        PHOTO.mkdir(parents=True, exist_ok=True)
        dest = PHOTO / f"{epic}.jpg"
        photo.save(dest, quality=85, optimize=True)
        v["photo"] = f"/photos/{epic}.jpg"
        updated += 1
        if updated % 500 == 0 or updated == n:
            print(f"  photos [{updated}/{n}]", flush=True)

    for doc in docs.values():
        doc.close()
    return updated


def main() -> None:
    force_slots = "--rebuild-slots" in sys.argv
    d = json.loads(OUT.read_text(encoding="utf-8"))
    voters = d["voters"]
    raw_rows = json.loads(RAW.read_text(encoding="utf-8")).get("rows", []) if RAW.exists() else []
    raw_by = {
        (int(r.get("ward") or 0), int(r.get("page") or 0), int(r.get("cardIndex") or 0)): r
        for r in raw_rows
    }

    slots = build_slots(force=force_slots)
    if len(slots) != len(voters):
        raise SystemExit(f"slot/voter count mismatch: slots={len(slots)} voters={len(voters)}")

    # Attach page from slot (authoritative)
    for i, v in enumerate(voters):
        v["ward"] = slots[i]["ward"]
        v["page"] = slots[i]["page"]
        v["part"] = slots[i]["ward"]

    serials, split = assign_serials(voters, slots, raw_by)
    print(f"serial split index={split} (skip missing printed serial there)", flush=True)

    # Validate against printed anchors
    match = mismatch = 0
    samples = []
    for i, v in enumerate(voters):
        key = (slots[i]["ward"], slots[i]["page"], slots[i]["cardIndex"])
        p = reliable_printed((raw_by.get(key) or {}).get("ocrText") or "", i)
        if p is None:
            continue
        if serials[i] == p:
            match += 1
        else:
            mismatch += 1
            if len(samples) < 12:
                samples.append((serials[i], p, v.get("epic"), v.get("name")))

    for i, v in enumerate(voters):
        v["serial"] = serials[i]

    print(f"printed anchors match={match} mismatch={mismatch}", flush=True)
    if samples:
        print("sample mismatches (assigned, printed, epic, name):", flush=True)
        for s in samples:
            print(f"  {s}", flush=True)

    # Spot-check Dinek / 6906 area before photo pass
    for v in voters:
        if v.get("epic") == "IAX0653816":
            print(f"Dinek Badhi -> S{v['serial']} {v.get('name')}", flush=True)

    print("Re-cropping photos from PDF card boxes…", flush=True)
    n_photos = recrop_photos(voters, slots)
    print(f"photos updated: {n_photos}", flush=True)

    voters.sort(key=lambda v: (v.get("serial") or 0, v.get("ward") or 0, v.get("page") or 0))
    d["voters"] = voters
    meta = d.setdefault("meta", {})
    meta["total"] = len(voters)
    meta["photosMapped"] = sum(1 for v in voters if v.get("photo") and (PHOTO / Path(v["photo"]).name).exists())
    meta["placeholderEpics"] = sum(
        1 for v in voters if str(v.get("epic", "")).startswith(("TMP", "UNK", "DUP"))
    )
    meta["male"] = sum(1 for v in voters if v.get("gender") == "Male")
    meta["female"] = sum(1 for v in voters if v.get("gender") == "Female")
    meta["missingName"] = sum(1 for v in voters if not (v.get("name") or v.get("nameTe")))
    meta["missingHouse"] = sum(1 for v in voters if not v.get("house"))
    meta["missingRelation"] = sum(
        1 for v in voters if not (v.get("relationName") or v.get("relationNameTe"))
    )
    meta["missingAge"] = sum(1 for v in voters if v.get("age") is None)
    meta["missingGender"] = sum(1 for v in voters if not v.get("gender"))
    meta["source"] = "fix_serials_and_photos: printed-serial align + PDF photo re-crop"
    meta["serialSplitIndex"] = split
    meta["officialTarget"] = 8009

    text = json.dumps(d, ensure_ascii=False, indent=2) + "\n"
    OUT.write_text(text, encoding="utf-8")
    LATEST.write_text(text, encoding="utf-8")

    print(
        f"Wrote {len(voters)} voters; serials {min(serials)}..{max(serials)}; "
        f"photosMapped={meta['photosMapped']}",
        flush=True,
    )
    print("Around S6904-6910:", flush=True)
    for v in voters:
        if 6904 <= (v.get("serial") or 0) <= 6910:
            print(
                f"  S{v['serial']} {v.get('epic')} {v.get('name')!r} photo={v.get('photo')}",
                flush=True,
            )


if __name__ == "__main__":
    main()
