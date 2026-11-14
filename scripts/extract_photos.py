#!/usr/bin/env python3
"""Extract voter photos from the GP PDF and map them to EPICs.

Layout: 3-column cards, photos sorted top→bottom / left→right per page,
matched to EPIC order on the same page.
"""

from __future__ import annotations

import io
import json
import re
from pathlib import Path

import fitz
from PIL import Image

PDF = Path("/Users/uday/Downloads/vedagirivaripalle 2026voterlist.pdf")
ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "web" / "public" / "photos"
VOTERS_JSON = ROOT / "web" / "public" / "data" / "voters.json"
MAP_JSON = ROOT / "web" / "public" / "data" / "photo_map.json"

EPIC_RE = re.compile(r"([A-Z]{3}\d{7})")
SERIAL_RE = re.compile(r"\.పం\.ఓ\.జా\.వ\.సం\s*\.\s*(\d+)")


def save_photo(doc: fitz.Document, xref: int, dest: Path) -> None:
    pix = fitz.Pixmap(doc, xref)
    if pix.n - pix.alpha >= 4:
        pix = fitz.Pixmap(fitz.csRGB, pix)
    if pix.alpha:
        pix = fitz.Pixmap(pix, 0)
    img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
    img.thumbnail((240, 320), Image.Resampling.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest, "JPEG", quality=82, optimize=True)


def page_portraits(page: fitz.Page) -> list[dict]:
    rows = []
    for info in page.get_image_info(xrefs=True):
        if info["width"] < 80 or info["height"] < 80:
            continue
        bbox = info["bbox"]
        rows.append({"xref": info["xref"], "y": bbox[1], "x": bbox[0]})
    rows.sort(key=lambda r: (round(r["y"] / 5) * 5, r["x"]))
    return rows


def main() -> None:
    doc = fitz.open(str(PDF))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    mapping: list[dict] = []
    used: set[str] = set()

    for pi in range(doc.page_count):
        page = doc[pi]
        text = page.get_text()
        epics = EPIC_RE.findall(text)
        serials = [int(s) for s in SERIAL_RE.findall(text)]
        portraits = page_portraits(page)
        if len(portraits) < 3 or len(epics) < 3:
            continue
        n = min(len(portraits), len(epics), len(serials) if serials else len(epics))
        if len(portraits) != len(epics):
            print(f"page {pi + 1}: portraits={len(portraits)} epics={len(epics)} (using {n})")
        for i in range(n):
            epic = epics[i].upper()
            if epic in used:
                continue
            dest = OUT_DIR / f"{epic}.jpg"
            try:
                save_photo(doc, portraits[i]["xref"], dest)
            except Exception as e:
                print(f"fail {epic}: {e}")
                continue
            used.add(epic)
            mapping.append(
                {
                    "epic": epic,
                    "serial": serials[i] if i < len(serials) else None,
                    "page": pi + 1,
                    "photo": f"/photos/{epic}.jpg",
                }
            )

    data = json.loads(VOTERS_JSON.read_text(encoding="utf-8"))
    by_epic = {m["epic"]: m["photo"] for m in mapping}
    linked = 0
    for v in data.get("voters", []):
        epic = str(v.get("epic") or "").upper()
        photo = by_epic.get(epic, "")
        v["photo"] = photo
        if photo:
            linked += 1
    data.setdefault("meta", {})["photosMapped"] = linked
    data["meta"]["photosExtracted"] = len(mapping)
    VOTERS_JSON.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    MAP_JSON.write_text(json.dumps({"count": len(mapping), "photos": mapping}, ensure_ascii=False), encoding="utf-8")
    print(f"Extracted {len(mapping)} photos · linked {linked}/{len(data.get('voters', []))} voters")


if __name__ == "__main__":
    main()
