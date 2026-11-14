/**
 * Dev/preview middleware: persist versioned voter JSON under public/data/
 * without overwriting the original voters.json.
 *
 * On each save:
 *  - write timestamped backup in versions/
 *  - rotate previous voters_latest.json → voters_latest.prev.json
 *  - update voters_latest.json pointer
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, 'public', 'data')
const versionsDir = path.join(dataDir, 'versions')
const latestPath = path.join(dataDir, 'voters_latest.json')
const prevLatestPath = path.join(dataDir, 'voters_latest.prev.json')

function ensureDirs() {
  fs.mkdirSync(versionsDir, { recursive: true })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(Buffer.concat(chunks).toString('utf8'))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, obj) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(obj))
}

function listVersions() {
  ensureDirs()
  const files = fs
    .readdirSync(versionsDir)
    .filter((f) => /^voters_enriched_.*\.json$/i.test(f))
    .map((filename) => {
      const full = path.join(versionsDir, filename)
      const st = fs.statSync(full)
      return {
        filename,
        url: `/data/versions/${filename}`,
        mtime: st.mtime.toISOString(),
        size: st.size,
      }
    })
    .sort((a, b) => (a.mtime < b.mtime ? 1 : -1))
  return files
}

function writeManifest(files, latestFile) {
  const manifest = {
    updatedAt: new Date().toISOString(),
    latest: latestFile || (files[0]?.filename ?? null),
    previous: fs.existsSync(prevLatestPath) ? 'voters_latest.prev.json' : null,
    versions: files.slice(0, 40),
  }
  fs.writeFileSync(path.join(versionsDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return manifest
}

function rotateLatest(newJson) {
  ensureDirs()
  if (fs.existsSync(latestPath)) {
    // Keep previous latest as quick rollback backup
    fs.copyFileSync(latestPath, prevLatestPath)
  }
  fs.writeFileSync(latestPath, newJson)
}

function attachApi(middlewares) {
  middlewares.use(async (req, res, next) => {
    const url = req.url?.split('?')[0] || ''
    if (url === '/api/data/versions' && req.method === 'GET') {
      try {
        const files = listVersions()
        return sendJson(res, 200, writeManifest(files, files[0]?.filename ?? null))
      } catch (e) {
        return sendJson(res, 500, { error: e.message })
      }
    }
    if (url === '/api/data/save-version' && req.method === 'POST') {
      try {
        ensureDirs()
        const raw = await readBody(req)
        const body = JSON.parse(raw || '{}')
        const version = String(body.version || Date.now())
        const filename = `voters_enriched_${version}.json`
        const payload = {
          meta: {
            ...(body.meta || {}),
            versionLabel: `enriched_${version}`,
            exportedAt: new Date().toISOString(),
            note: 'Versioned save + backup. Original voters.json was not modified.',
            isLatest: true,
          },
          voters: Array.isArray(body.voters) ? body.voters : [],
        }
        const versionPath = path.join(versionsDir, filename)
        const json = JSON.stringify(payload, null, 2)
        // Timestamped backup (never deleted by update)
        fs.writeFileSync(versionPath, json)
        // Update latest pointer after rotating previous latest → .prev
        rotateLatest(json)
        const files = listVersions()
        const manifest = writeManifest(files, filename)
        return sendJson(res, 200, {
          ok: true,
          filename,
          latestUrl: '/data/voters_latest.json',
          previousUrl: fs.existsSync(prevLatestPath) ? '/data/voters_latest.prev.json' : null,
          versionUrl: `/data/versions/${filename}`,
          backupCount: files.length,
          manifest,
        })
      } catch (e) {
        return sendJson(res, 500, { error: e.message || 'Save failed' })
      }
    }
    return next()
  })
}

export function versionDataPlugin() {
  return {
    name: 'sarpanch-version-data',
    configureServer(server) {
      attachApi(server.middlewares)
    },
    configurePreviewServer(server) {
      attachApi(server.middlewares)
    },
  }
}
