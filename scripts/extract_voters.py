#!/usr/bin/env python3
"""Extract Vedagirivaripalle GP voter list PDF → English JSON for the React app."""

from __future__ import annotations

import json
import re
from pathlib import Path

import fitz
from indic_transliteration import sanscript
from indic_transliteration.sanscript import transliterate

PDF = Path("/Users/uday/Downloads/vedagirivaripalle 2026voterlist.pdf")
OUT = Path(__file__).resolve().parents[1] / "web" / "public" / "data" / "voters.json"

HABITATIONS = [
    {"id": 1, "name_te": "కొత్త వెంకట రామాపురం", "from": 1, "to": 1},
    {"id": 2, "name_te": "దిగువ నాగులవారి పల్లి", "from": 2, "to": 80},
    {"id": 3, "name_te": "ఎగువ నాగులవారి పల్లి", "from": 81, "to": 122},
    {"id": 4, "name_te": "గుట్ట పాళ్యం", "from": 123, "to": 162},
    {"id": 5, "name_te": "వేదగిరి వారి పల్లి", "from": 163, "to": 315},
    {"id": 6, "name_te": "శింగం శెట్టి హరిజనవాడ", "from": 316, "to": 388},
    {"id": 7, "name_te": "చుక్కా వారి పల్లి", "from": 389, "to": 694},
    {"id": 8, "name_te": "చుక్కా వారి పల్లి యస్ టి కాలనీ", "from": 695, "to": 804},
    {"id": 9, "name_te": "ఎగువ గూబల వారి పల్లి", "from": 805, "to": 1021},
    {"id": 10, "name_te": "ఆరుంధతి వాడ", "from": 1022, "to": 1076},
    {"id": 11, "name_te": "దిగువ గూబల వారి పల్లి", "from": 1077, "to": 1141},
]

LABEL_START = re.compile(
    r"^(ఓటరు|తండ్రి|తల్లి|భర్త|వయస్సు|లింగము|ఇంటి|\.పం|అ\.ఓ|SEC |పుట |వేదగిరి|గ్రా|పూతల|మండల|వార్డు|జిల్లా|ప్ర)"
)

FOOTER_START = re.compile(
    r"^(వయస్సు\s*లెక్క|ప్ర\s*చురణ|ప్రచురణ|పుట\s*సంఖ్య|SEC |https?://|sec-ems)"
)

HAB_EN = {
    1: "Kotta Venkata Ramapuram",
    2: "Diguvva Nagulavaripalli",
    3: "Eguva Nagulavaripalli",
    4: "Gutta Palyam",
    5: "Vedagirivaripalli",
    6: "Singam Setti Harijanawada",
    7: "Chukkavaripalli",
    8: "Chukkavaripalli ST Colony",
    9: "Eguva Gubalavaripalli",
    10: "Arundhatiwada",
    11: "Diguvva Gubalavaripalli",
}

WORD_FIX = [
    (r"\bNayudu\b", "Naidu"),
    (r"\bNayuduji\b", "Naidu"),
    (r"\bVemkata\b", "Venkata"),
    (r"\bVemkatalakshmi\b", "Venkatalakshmi"),
    (r"\bSvami\b", "Swamy"),
    (r"\bSvamy\b", "Swamy"),
    (r"\bKomda\b", "Konda"),
    (r"\bRamkomda\b", "Ramkonda"),
    (r"\bGurramramkomda\b", "Gurram Ramkonda"),
    (r"\bReddi\b", "Reddy"),
    (r"\bShriinivasulu\b", "Srinivasulu"),
    (r"\bPushpammjali\b", "Pushpanjali"),
    (r"\bBimdu\b", "Bindu"),
    (r"\bChamdra\b", "Chandra"),
    (r"\bChamdrashekhara\b", "Chandrasekhara"),
    (r"\bRamachamdranayudu\b", "Ramachandra Naidu"),
    (r"\bTishubramanyam\b", "T Subrahmanyam"),
    (r"\bKamtamma\b", "Kantamma"),
    (r"\bMunasvami\b", "Moona Swamy"),
    (r"\bArumdhati\b", "Arundhati"),
    (r"\bShimgam\b", "Singam"),
    (r"\bShetti\b", "Setti"),
    (r"\bHarijanavada\b", "Harijanawada"),
    (r"\bGita\b", "Geetha"),
    (r"\bAchapa\b", "Ayyappa"),
    (r"\btalli\b", ""),
    (r"\bPeru\b", ""),
    (r"\bTalli\b", ""),
]


def clean_spaces(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("\xa0", " ")).strip()


def join_soft_breaks(text: str) -> str:
    """Join mid-word Telugu line breaks, but never across field labels."""
    lines = text.replace("\xa0", " ").splitlines()
    out: list[str] = []
    i = 0
    while i < len(lines):
        cur = lines[i].rstrip()
        while i + 1 < len(lines):
            nxt = lines[i + 1].lstrip()
            if not nxt:
                break
            if LABEL_START.match(nxt) or LABEL_START.match(nxt.lstrip()):
                break
            # mid-word: current ends with Telugu, next starts with Telugu, no leading spaces intent
            if (
                cur
                and nxt
                and "\u0C00" <= cur[-1] <= "\u0C7F"
                and "\u0C00" <= nxt[0] <= "\u0C7F"
                and not cur.endswith((" ", ":", ".", ","))
                and not nxt.startswith((":", " "))
                and not nxt.strip() in (":", "పేరు")
            ):
                # Avoid joining value into "పేరు" alone
                if nxt.strip() == "పేరు" or nxt.startswith("పేరు"):
                    break
                cur = cur + nxt
                i += 1
                continue
            break
        out.append(cur)
        i += 1
    return "\n".join(out)


def to_english(s: str) -> str:
    s = clean_spaces(s)
    if not s:
        return ""
    # strip accidental label fragments
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
            .replace(".t", "t")
            .replace(".d", "d")
            .replace(".r", "r")
            .replace(".l", "l")
            .replace(".s", "sh")
            .replace("RRi", "ri")
            .replace("R^i", "ri")
            .replace("LLi", "li")
            .replace("aa", "a")
            .replace("ii", "i")
            .replace("uu", "u")
            .replace("chh", "ch")
        )
        t = re.sub(r"[òóôö]", "o", t)
        t = re.sub(r"[èéêë]", "e", t)
        t = re.sub(r"(?<![aeiouAEIOU])M\b", "", t)
        t = re.sub(r"(?<![aeiouAEIOU])M", "m", t)
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
    if age < 30:
        return "18-29"
    if age < 40:
        return "30-39"
    if age < 50:
        return "40-49"
    if age < 60:
        return "50-59"
    if age < 70:
        return "60-69"
    return "70+"


def habitation_for(serial: int) -> dict | None:
    for h in HABITATIONS:
        if h["from"] <= serial <= h["to"]:
            return h
    return None


def parse_gender(raw: str) -> str:
    raw = clean_spaces(raw)
    g = raw.replace(" ", "")
    if "స్త్రీ" in g or ("స్" in raw and "త్రీ" in raw) or "Female" in raw:
        return "Female"
    if "పు" in raw or "Male" in raw:
        return "Male"
    return ""


def read_colon_value(lines: list[str], start: int) -> str:
    """After a label line, read ': value' on same or following lines."""
    line = lines[start]
    if ":" in line:
        after = clean_spaces(line.split(":", 1)[1])
        if after and not LABEL_START.match(after):
            return after
    for j in range(start + 1, min(start + 5, len(lines))):
        nxt = lines[j].strip()
        if not nxt:
            continue
        if nxt == ":":
            continue
        if nxt.startswith(":"):
            return clean_spaces(nxt[1:])
        if LABEL_START.match(nxt) or nxt == "పేరు":
            return ""
        return clean_spaces(nxt)
    return ""


def parse_block(chunk: str) -> dict:
    lines = [ln.strip() for ln in chunk.splitlines()]
    name = father = mother = husband = age_s = gender_raw = house = epic = ""

    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        # Stop at page footer / publication lines so they don't overwrite age etc.
        if FOOTER_START.match(line) or line.startswith("వయస్సు లెక్క"):
            break

        if line.startswith("ఓటరు పేరు") or line == "ఓటరు పేరు":
            if not name:
                name = read_colon_value(lines, i)
            i += 1
            continue

        if line.startswith("భర్త పేరు"):
            if not husband:
                husband = read_colon_value(lines, i)
            i += 1
            continue

        if "తల్లి" in line:
            if "పేరు" in line:
                if not mother:
                    mother = read_colon_value(lines, i)
            else:
                for j in range(i + 1, min(i + 4, len(lines))):
                    if "పేరు" in lines[j]:
                        if not mother:
                            mother = read_colon_value(lines, j)
                        break
            i += 1
            continue

        if "తండ్రి" in line:
            if "పేరు" in line:
                if not father:
                    father = read_colon_value(lines, i)
            else:
                for j in range(i + 1, min(i + 4, len(lines))):
                    if "పేరు" in lines[j]:
                        if not father:
                            father = read_colon_value(lines, j)
                        break
            i += 1
            continue

        if line.strip() == "పేరు" and not father and not husband and not mother:
            val = read_colon_value(lines, i)
            if val and not father:
                father = val
            i += 1
            continue

        if line.startswith("వయస్సు"):
            # Ignore "వయస్సు లెక్కింపు తేదీ" footer
            if "లెక్క" in line:
                break
            if not age_s:
                age_s = read_colon_value(lines, i)
            i += 1
            continue

        if line.startswith("లింగము"):
            if not gender_raw:
                gender_raw = read_colon_value(lines, i)
                if gender_raw in ("స్", "స") or gender_raw.endswith("స్"):
                    for j in range(i + 1, min(i + 3, len(lines))):
                        if "త్రీ" in lines[j]:
                            gender_raw = "స్త్రీ"
                            break
            i += 1
            continue

        if line.startswith("ఇంటి"):
            if not house:
                house = read_colon_value(lines, i)
            i += 1
            continue

        if "ఐడి" in line or "కార్డు" in line:
            m = re.search(r"([A-Z]{3}\d{7})", line)
            if m and not epic:
                epic = m.group(1)
            i += 1
            continue

        i += 1

    if not epic:
        m = re.search(r"([A-Z]{3}\d{7})", chunk)
        if m:
            epic = m.group(1)

    for label in ("తండ్రి", "తల్లి", "భర్త", "వయస్సు", "లింగము", "పేరు"):
        if name and label in name:
            name = name.split(label)[0].strip()
        if father and label in father and label != "తండ్రి":
            father = father.split(label)[0].strip()
        if mother and label in mother and label != "తల్లి":
            mother = mother.split(label)[0].strip()
        if husband and label in husband:
            husband = husband.split(label)[0].strip()

    age_n = None
    am = re.search(r"^(\d{1,3})\b", clean_spaces(age_s or ""))
    if am:
        age_n = int(am.group(1))
        if age_n < 18 or age_n > 120:
            age_n = None

    return {
        "name": clean_spaces(name),
        "father": clean_spaces(father),
        "mother": clean_spaces(mother),
        "husband": clean_spaces(husband),
        "age": age_n,
        "gender": parse_gender(gender_raw),
        "house": clean_spaces(house),
        "epic": epic,
    }


def main() -> None:
    doc = fitz.open(str(PDF))
    pages = [join_soft_breaks(doc[i].get_text()) for i in range(doc.page_count)]

    ward_by_serial: dict[int, int] = {}
    page_by_serial: dict[int, int] = {}
    current_ward = None
    serial_re = re.compile(r"\.పం\.ఓ\.జా\.వ\.సం\s*\.\s*(\d+)")

    for pi, page_text in enumerate(pages):
        wm = re.search(r"వార్డు\s*నె[౦0]?బరు\s*:\s*(\d+)", page_text)
        if wm:
            current_ward = int(wm.group(1))
        for m in serial_re.finditer(page_text):
            serial = int(m.group(1))
            page_by_serial[serial] = pi + 1
            if current_ward is not None:
                ward_by_serial[serial] = current_ward

    full = "\n".join(pages)
    chunks = re.split(r"(?=\.పం\.ఓ\.జా\.వ\.సం\s*\.\s*\d+)", full)
    voters: list[dict] = []

    for chunk in chunks:
        m = serial_re.search(chunk)
        if not m:
            continue
        serial = int(m.group(1))
        asm_m = re.search(r"అ\.ఓ\.జా\.వ\.సం\s*\.\s*([\d\s\-]+)", chunk)
        assembly_serial = clean_spaces(asm_m.group(1)) if asm_m else ""

        fields = parse_block(chunk)
        if fields["husband"]:
            relation_type, relation_te = "Husband", fields["husband"]
        elif fields["father"]:
            relation_type, relation_te = "Father", fields["father"]
        elif fields["mother"]:
            relation_type, relation_te = "Mother", fields["mother"]
        else:
            relation_type, relation_te = "", ""
        hab = habitation_for(serial)
        ward = ward_by_serial.get(serial)
        hab_en = HAB_EN.get(hab["id"], to_english(hab["name_te"])) if hab else ""

        voters.append(
            {
                "serial": serial,
                "epic": fields["epic"],
                "name": to_english(fields["name"]),
                "nameTe": fields["name"],
                "relationType": relation_type,
                "relationName": to_english(relation_te),
                "relationNameTe": relation_te,
                "house": fields["house"],
                "age": fields["age"],
                "ageBand": age_band(fields["age"]),
                "gender": fields["gender"],
                "ward": ward,
                "part": ward,
                "habitation": hab_en,
                "habitationTe": hab["name_te"] if hab else "",
                "habitationId": hab["id"] if hab else None,
                "section": hab_en,
                "sectionName": hab_en,
                "sectionNo": str(hab["id"]) if hab else "",
                "assemblySerial": assembly_serial,
                "constituency": "173 - Puthalapattu",
                "constituencyLabel": "173 - Puthalapattu",
                "district": "Chittoor",
                "tehsilMandal": "Irala",
                "mainTown": "Chukkavaripalli",
                "panchayat": "Sarpanch Elections Chukkavaripalli",
                "yearOfRevision": "2026",
                "typeOfRevision": "GP Elections 2026",
                "page": page_by_serial.get(serial),
                "phone": "",
                "currentAddress": "",
                "notes": "",
                "voterStatus": "",
                "photo": "",
                "pollingStationName": f"Ward {ward}" if ward else "",
            }
        )

    voters.sort(key=lambda v: v["serial"])

    # Re-attach photos from prior extract map if present
    map_path = OUT.parent / "photo_map.json"
    if map_path.exists():
        by_epic = {
            m["epic"]: m["photo"]
            for m in json.loads(map_path.read_text(encoding="utf-8")).get("photos", [])
        }
        for v in voters:
            v["photo"] = by_epic.get(str(v.get("epic") or "").upper(), "")

    for h in HABITATIONS:
        h["name"] = HAB_EN.get(h["id"], to_english(h["name_te"]))

    meta = {
        "panchayat": "Sarpanch Elections Chukkavaripalli",
        "appName": "Sarpanch Elections Chukkavaripalli",
        "district": "Chittoor",
        "mandal": "Irala",
        "assembly": "173 - Puthalapattu",
        "year": 2026,
        "total": len(voters),
        "male": sum(1 for v in voters if v["gender"] == "Male"),
        "female": sum(1 for v in voters if v["gender"] == "Female"),
        "wards": sorted({v["ward"] for v in voters if v["ward"]}),
        "photosMapped": sum(1 for v in voters if v.get("photo")),
        "habitations": [
            {
                "id": h["id"],
                "name": h["name"],
                "nameTe": h["name_te"],
                "from": h["from"],
                "to": h["to"],
            }
            for h in HABITATIONS
        ],
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"meta": meta, "voters": voters}, ensure_ascii=False), encoding="utf-8")

    age1 = sum(1 for v in voters if v["age"] == 1)
    mothers = sum(1 for v in voters if v["relationType"] == "Mother")
    print(f"Wrote {len(voters)} voters → {OUT}")
    print(
        f"male={meta['male']} female={meta['female']} "
        f"missing_name={sum(1 for v in voters if not v['name'])} "
        f"missing_epic={sum(1 for v in voters if not v['epic'])} "
        f"age1={age1} mothers={mothers} photos={meta['photosMapped']}"
    )
    print("sample 27:", json.dumps(next(v for v in voters if v["serial"] == 27), ensure_ascii=False, indent=2))
    print("sample 89:", json.dumps(next(v for v in voters if v["serial"] == 89), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
