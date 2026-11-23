#!/usr/bin/env python3
"""Full Damalacheruvu pipeline: extract → reparse → recover missing EPICs → summarize."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = Path(__file__).resolve().parent


def run(script: str) -> None:
    print(f"\n===== {script} =====", flush=True)
    rc = subprocess.call([sys.executable, str(SCRIPTS / script)], cwd=str(SCRIPTS))
    if rc != 0:
        raise SystemExit(f"{script} failed with {rc}")


def summarize() -> None:
    data = json.loads((ROOT / "web/public/data/voters.json").read_text(encoding="utf-8"))
    vs = data["voters"]
    m = data["meta"]

    def miss(key: str) -> int:
        if key == "age":
            return sum(1 for v in vs if v.get("age") is None)
        return sum(1 for v in vs if not (v.get(key) or "").strip())

    print("\n===== SUMMARY =====")
    print(f"total={len(vs)} wards={m.get('wards')} photos={m.get('photosMapped')}")
    for k in ("name", "relationName", "house", "gender", "age"):
        n = miss(k)
        print(f"missing {k}: {n} ({100 * n / max(1, len(vs)):.0f}%)")


def main() -> None:
    # 1) OCR all ward PDF pages → raw cache + initial voters
    run("extract_damalacheruvu_ocr.py")
    # 2) Re-parse OCR text (names/houses/EPICs) into voters.json
    run("reparse_damalacheruvu_ocr.py")
    # 3) Re-OCR cards that still lack EPIC and append recovered voters
    run("recover_noepic_cards.py")
    summarize()


if __name__ == "__main__":
    main()
