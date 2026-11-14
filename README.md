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

## Deploy on Render (static site)

1. Push this repo to GitHub (already: `udaythammichetti/ckp-voterlist-enrich`).
2. In [Render](https://dashboard.render.com): **New** → **Blueprint** → select the repo  
   (uses `render.yaml`), **or** **New** → **Static Site** with:
   - **Root Directory:** `web`
   - **Build Command:** `npm ci && npm run build`
   - **Publish Directory:** `dist`
3. Add rewrite: `/*` → `/index.html` (SPA routes).

**Note:** Phone / address / status still save in the browser. **Save version** to the project folder is a local Vite-dev feature and is not available on the static Render host.

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
