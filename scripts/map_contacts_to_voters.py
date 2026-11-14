#!/usr/bin/env python3
"""Map field contact sheet (name + village) → voter phone / currentAddress.

Only high-confidence unique epic mappings are applied.
"""

from __future__ import annotations

import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTACTS = Path(__file__).with_name('contacts_field_sheet.json')
VOTERS_SRC = ROOT / 'web' / 'public' / 'data' / 'voters.json'
VOTERS_LATEST = ROOT / 'web' / 'public' / 'data' / 'voters_latest.json'
OUT_REPORT = ROOT / 'web' / 'public' / 'data' / 'contact_map_report.json'
OUT_PATCH = ROOT / 'web' / 'public' / 'data' / 'enrichment_contacts_patch.json'

KEEP_FROM_LATEST = (
    'notes',
    'voterStatus',
    'name',
    'relationType',
    'relationName',
    'house',
    'age',
    'gender',
)

LOC_EXPAND = {
    'tpt': 'Tirupati',
    'bgl': 'Bengaluru',
    'hyd': 'Hyderabad',
    'dmc': 'Damalacheruvu',
    'ctr': 'Chittoor',
    'tirupati': 'Tirupati',
    'bangalore': 'Bengaluru',
    'gudur': 'Gudur',
    'nellore': 'Nellore',
    'srikalahasti': 'Srikalahasti',
    'anantapur': 'Anantapur',
}

# High-confidence sheet-name → epic (verified unique in village)
MANUAL_EPICS = {
    # Vedagirivaripalli
    'v dhananjaya naidu': 'SQB0243618',
    'v dhananjaya naidu raja': 'SQB0300053',
    'v somashekar naidu': 'SQB0563081',
    'v bharath kumar': 'SQB2115137',
    'v desamma': 'SQB0703919',
    'v sujith': 'SQB0243600',
    'v subrahmanyam naidu': 'SQB0300004',
    'g jyotheshwara naidu': 'SQB0512393',
    'r ganesh': 'SQB0879353',
    'r hemanth': 'SQB0570649',
    'p mallikarjuna naidu': 'SQB0706426',
    'g v kishore kumar': 'SQB2187995',
    'gv kishore kumar': 'SQB2187995',
    'g v mohan krishna': 'SQB2121895',
    'gv mohan krishna': 'SQB2121895',
    'v mahesh naidu': 'SQB0740994',
    'g devarajulu naidu': 'SQB0570706',
    'g tulasi naidu': 'BDG2946523',
    'g vinayak naidu': 'SQB2153039',
    'g damodar naidu': 'SQB0704024',
    'g uday kumar': 'SQB0706384',
    # Singam Setti Harijanawada
    's chandrakanth': 'SQB2036143',
    's manoj': 'SQB0769655',
    't lokesh': 'SQB1918077',
    'p rajashekar': 'SQB0391847',
    'p ranjith kumar': 'BDG2946598',
    'g rakesh': 'SQB1917855',
    's srinivasulu': 'SQB0706236',
    'm mahesh': 'SQB0706467',
    's muralamma': 'SQB0284679',

    # Chukkavaripalli
    't vinay': 'SQB2047892',
    't dhanush': 'SQB2061752',
    't anil kumar': 'SQB0373142',
    'm narasimhulu': 'SQB1138262',
    'm suresh': 'SQB0796393',
    'm naresh': 'SQB0780586',
    's ravi': 'SQB0796427',
    't lokesh naidu': 'SQB0087742',
    'k jayachandra reddy': 'BDG2946937',
    'k jayaram reddy': 'BDG2337046',
    't ramakrishna naidu': 'SQB1137587',
    't jyotheshwar naidu': 'SQB0703950',
    't damodar naidu': 'SQB1137553',
    'p dilip reddy': 'SQB0013235',
    'd ravi': 'BDG2337384',
    't satish': 'SQB1038710',
    't muni ratnam': 'SQB0706269',
    't venkateshwar rao': 'SQB1022383',
    'v chinnamma': 'SQB0703828',
    'v naresh': 'SQB0780586',  # conflict with m naresh — drop one later
    'k durgaprasad': 'SQB0563040',
    'b vikram': 'SQB0512427',
    'b vijay': 'SQB0796401',
    't uday kumar': 'SQB0372813',
    't mallikarjuna': 'SQB1022391',
    't madhu': 'SQB0243295',
    't tyagaraju': 'BDG2947059',
    'k ashok kumar': 'SQB1968098',
    'k chandrashekar': 'SQB0512401',
    'k suresh babu': 'SQB0825034',
    's subbaramaiah': 'SQB0741000',
    # Chukkavaripalli — household / unique matches
    't tulasamma': 'SQB1137595',  # same house as Taluri Lokesh; shared phone
    'k tulasamma': 'BDG2948347',  # Ke. Tulasi, Chukkavaripalli ST Colony
}


def norm_text(s: str) -> str:
    s = unicodedata.normalize('NFKC', s or '')
    s = re.sub(r'[\u200b-\u200f\ufeff]', '', s)
    s = s.lower()
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def sheet_key(name: str) -> str:
    s = unicodedata.normalize('NFKC', name or '')
    s = re.sub(r'[\u200b-\u200f\ufeff]', '', s).lower()
    s = re.sub(r'[\(\)]', ' ', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def expand_location(raw: str) -> str:
    raw = (raw or '').strip()
    if not raw:
        return ''
    parts = re.split(r'\s*/\s*', raw)
    out = []
    for p in parts:
        key = norm_text(p)
        out.append(LOC_EXPAND.get(key, p.strip()))
    seen = set()
    final = []
    for x in out:
        if x and x not in seen:
            seen.add(x)
            final.append(x)
    return ' / '.join(final)


def clean_phone(p: str) -> str:
    digits = re.sub(r'\D+', '', p or '')
    if len(digits) == 10:
        return digits
    if len(digits) == 11 and digits.startswith('0'):
        return digits[1:]
    if len(digits) == 12 and digits.startswith('91'):
        return digits[2:]
    if len(digits) >= 10:
        return digits[-10:]
    return digits


def load_payload(path: Path):
    data = json.loads(path.read_text())
    if isinstance(data, dict) and 'voters' in data:
        return data, data['voters']
    return {'meta': {}, 'voters': data}, data


def resolve_placeholders(voters):
    """Replace sentinel values with unique epic lookups."""
    def one(pred):
        hits = [v for v in voters if pred(v)]
        return hits[0]['epic'] if len(hits) == 1 else None

    mapping = dict(MANUAL_EPICS)
    # Fix VI Sujit
    mapping['g lohith sai'] = one(
        lambda v: v.get('habitation') == 'Vedagirivaripalli'
        and 'lohit' in norm_text(v.get('name'))
        and 'sayi' in norm_text(v.get('name'))
    )
    mapping['g leelaprasad naidu'] = one(
        lambda v: v.get('habitation') == 'Vedagirivaripalli' and 'lilaprasad' in norm_text(v.get('name')).replace(' ', '')
    )
    mapping['c harish'] = one(
        lambda v: v.get('habitation') == 'Vedagirivaripalli' and norm_text(v.get('name')).startswith('harish')
    )
    mapping['g karthik naidu'] = one(
        lambda v: v.get('habitation') == 'Vedagirivaripalli' and 'kartik kumar gorrerepati' in norm_text(v.get('name'))
    )
    mapping.pop('v naresh', None)
    return {k: v for k, v in mapping.items() if v and re.fullmatch(r'[A-Z0-9]+', v or '')}


def main() -> None:
    contacts = json.loads(CONTACTS.read_text())
    _, base_voters = load_payload(VOTERS_SRC)
    latest_payload, latest_voters = (
        load_payload(VOTERS_LATEST) if VOTERS_LATEST.exists() else ({}, base_voters)
    )
    latest_by_epic = {v['epic']: v for v in latest_voters}

    voters = []
    by_epic = {}
    for b in base_voters:
        row = dict(b)
        prev = latest_by_epic.get(b['epic'])
        if prev:
            for k in KEEP_FROM_LATEST:
                if prev.get(k) not in (None, ''):
                    row[k] = prev[k]
        row['phone'] = ''
        row['currentAddress'] = ''
        voters.append(row)
        by_epic[row['epic']] = row

    manual = resolve_placeholders(voters)

    matched = []
    unmatched = []
    enrichment = {}
    used = set()

    for c in contacts:
        phone = clean_phone(c.get('phone') or '')
        addr = expand_location(c.get('location') or '')
        if not phone and not addr:
            unmatched.append({**c, 'reason': 'no phone or location'})
            continue

        key = sheet_key(c['name'])
        epic = manual.get(key)
        if not epic:
            unmatched.append({**c, 'reason': 'no confident unique match'})
            continue
        if epic in used:
            unmatched.append({**c, 'reason': f'epic already used ({epic})'})
            continue
        voter = by_epic.get(epic)
        if not voter:
            unmatched.append({**c, 'reason': f'epic not in roll ({epic})'})
            continue

        used.add(epic)
        if phone:
            voter['phone'] = phone
        if addr:
            voter['currentAddress'] = addr
        patch = {}
        if phone:
            patch['phone'] = phone
        if addr:
            patch['currentAddress'] = addr
        if voter.get('notes'):
            patch['notes'] = voter['notes']
        enrichment[epic] = patch
        matched.append(
            {
                'sheetName': c['name'],
                'sheetVillage': c['village'],
                'phone': phone,
                'address': addr,
                'epic': epic,
                'voterName': voter['name'],
                'habitation': voter.get('habitation'),
            }
        )

    stamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
    payload = {
        'meta': {
            **(latest_payload.get('meta') or {}),
            'sourceFile': 'voters.json',
            'contactMappedAt': datetime.now(timezone.utc).isoformat(),
            'contactMapSource': 'contacts_field_sheet.json',
            'contactMatched': len(matched),
            'contactUnmatched': len(unmatched),
            'versionLabel': f'contacts_{stamp}',
            'exportedAt': datetime.now(timezone.utc).isoformat(),
            'electorCount': len(voters),
            'isLatest': True,
            'projectPath': 'web/public/data/voters_latest.json',
            'note': 'Phones/addresses mapped from field contact sheet by name+village (high-confidence only). Original voters.json untouched.',
            'loadedFrom': 'voters_latest.json',
        },
        'voters': voters,
    }

    VOTERS_LATEST.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    OUT_PATCH.write_text(
        json.dumps(
            {
                'meta': {
                    'type': 'enrichment_patch',
                    'source': 'contacts_field_sheet.json',
                    'createdAt': datetime.now(timezone.utc).isoformat(),
                    'count': len(enrichment),
                },
                'map': enrichment,
            },
            ensure_ascii=False,
            indent=2,
        )
        + '\n'
    )
    OUT_REPORT.write_text(
        json.dumps(
            {
                'matched': matched,
                'unmatched': unmatched,
                'summary': {
                    'contacts': len(contacts),
                    'matched': len(matched),
                    'unmatched': len(unmatched),
                    'phonesWritten': sum(1 for m in matched if m['phone']),
                    'addressesWritten': sum(1 for m in matched if m['address']),
                },
            },
            ensure_ascii=False,
            indent=2,
        )
        + '\n'
    )

    print(
        f"matched={len(matched)} unmatched={len(unmatched)} "
        f"phones={sum(1 for m in matched if m['phone'])} "
        f"addrs={sum(1 for m in matched if m['address'])}"
    )
    print('\nMATCHED', len(matched))
    for m in matched:
        print(f"  {m['sheetName']!r:32} -> {m['voterName']!r:32} | {m['phone']} | {m['address']}")
    print('\nUNMATCHED', len(unmatched))
    for u in unmatched:
        print(f"  {u['name']!r:32} [{u['village']}]")


if __name__ == '__main__':
    main()
