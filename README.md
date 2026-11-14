# Sarpanch Elections Chukkavaripalli

React + Vite dashboard for **Sarpanch Elections Chukkavaripalli** (2026 voter list, English), modeled on the KPHP voter app.

## Features

- Dashboard KPIs, age / household mix
- **Ward-wise** and **village / habitation** directories
- **Family hierarchy** (house + relation linking)
- Voter detail: phone / address / status / notes — **Postgres on Render**, live across users (SSE)
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

## Deploy on Render (Web Service + Postgres)

Enrichment (phone / status / address / notes) is stored in **Render Postgres** and synced live across users.

1. Push this repo to GitHub: `udaythammichetti/ckp-voterlist-enrich`
2. [Render](https://dashboard.render.com) → **New** → **Blueprint** → select the repo (`render.yaml`)
3. Approve **Web Service** + **Postgres** (`ckp-voterlist-db`)
4. After deploy, header shows **Live DB** when Postgres is connected

### Manual Web Service parameters

| Field | Value |
|---|---|
| Root Directory | `web` |
| Runtime | Node |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm run start` |
| `NODE_VERSION` | `20` |
| `NPM_CONFIG_PRODUCTION` | `false` |
| `DATABASE_URL` | from Render Postgres (Internal URL) |
| `AUTH_USER` | your login username |
| `AUTH_PASSWORD` | your login password |

### Login (username / password)

1. Web Service → **Environment**
2. Add:
   - `AUTH_USER` = e.g. `ckp`
   - `AUTH_PASSWORD` = a strong password
3. **Save** → redeploy
4. Open the site → you get a **Sign in** page
5. Use **Logout** in the header when done

If `AUTH_USER` / `AUTH_PASSWORD` are missing, the site stays open (local/dev). `/api/health` stays public for Render health checks.

Local Vite (`npm run dev`) still uses browser storage when `/api` is unavailable.

## Data

- Source PDF: `vedagirivaripalle 2026voterlist.pdf`
- Extracted JSON: `web/public/data/voters.json` (1,141 electors, English transliteration)
- Photos: `web/public/photos/{EPIC}.jpg` (mapped from PDF cards · ~1,140)
- Enrichment (phone / address / status / notes): Postgres when `DATABASE_URL` is set; otherwise browser `localStorage`

```bash
python3 scripts/extract_photos.py   # re-map photos from PDF
```

## Layout

```
scripts/extract_voters.py   PDF → English JSON
web/                        Vite React app + Express API
  server/                   Postgres enrichment API + SSE + static host
  public/data/voters.json
  src/pages/                Dashboard, Campaign, Voters, Wards, Villages, Families, Consolidated
```
