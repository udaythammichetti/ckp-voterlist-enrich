# Sarpanch Elections Chukkavaripalli

React + Vite dashboard for **Sarpanch Elections Chukkavaripalli** (2026 voter list, English), modeled on the KPHP voter app.

## Features

- Dashboard KPIs, age / household mix
- **Ward-wise** and **village / habitation** directories
- **Family hierarchy** (house + relation linking)
- Voter detail: add **phone number** and **current address** (saved in browser `localStorage`)
- EN | తెలుగు toggle (UI labels + original Telugu names from PDF)

## Quick start

```bash
# (optional) re-extract from PDF
python3 scripts/extract_voters.py

cd web
npm install
npm run dev
```

App: http://localhost:5173

## Data

- Source PDF: `vedagirivaripalle 2026voterlist.pdf`
- Extracted JSON: `web/public/data/voters.json` (1,141 electors, English transliteration)
- Photos: `web/public/photos/{EPIC}.jpg` (mapped from PDF cards · ~1,140)
- Enrichment (phone / address / status / notes) is per-browser, keyed by voter ID

```bash
python3 scripts/extract_photos.py   # re-map photos from PDF
```

## Layout

```
scripts/extract_voters.py   PDF → English JSON
web/                        Vite React app
  public/data/voters.json
  src/pages/                Dashboard, Voters, Wards, Villages, Families
```
