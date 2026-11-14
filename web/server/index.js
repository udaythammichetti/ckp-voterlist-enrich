import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  databaseHostInfo,
  enrichmentCount,
  getEnrichment,
  hasDatabase,
  importEnrichmentMap,
  listEnrichment,
  migrate,
  resetPool,
  upsertEnrichment,
} from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const dist = path.join(root, 'dist')
const port = Number(process.env.PORT) || 4173

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(express.json({ limit: '4mb' }))

/** @type {Set<import('express').Response>} */
const sseClients = new Set()

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of sseClients) {
    try {
      res.write(payload)
    } catch {
      sseClients.delete(res)
    }
  }
}

async function migrateWithRetry(attempts = 15) {
  const info = databaseHostInfo()
  console.log(
    `[db] migrate start host=${info.host} ssl=${info.ssl} internal=${info.likelyInternal}`,
  )
  if (info.configured && !info.likelyInternal) {
    console.warn(
      '[db] DATABASE_URL looks EXTERNAL (*.render.com). Prefer Internal Database URL from the Postgres Info page.',
    )
  }

  let lastErr
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await migrate()
      return
    } catch (err) {
      lastErr = err
      console.warn(`[db] migrate attempt ${i}/${attempts} failed:`, err.message || err)
      resetPool()
      const waitMs = Math.min(8000, 1500 * i)
      await new Promise((r) => setTimeout(r, waitMs))
    }
  }
  throw lastErr || new Error('Database migrate failed')
}

app.get('/api/health', async (_req, res) => {
  let dbOk = false
  let count = 0
  try {
    if (hasDatabase()) {
      count = await enrichmentCount()
      dbOk = true
    }
  } catch (err) {
    return res.status(503).json({
      ok: false,
      db: false,
      error: err.message || 'db error',
    })
  }
  res.json({ ok: true, db: dbOk, enrichmentCount: count })
})

app.get('/api/enrichment', async (_req, res) => {
  try {
    if (!hasDatabase()) return res.status(503).json({ error: 'DATABASE_URL missing' })
    const map = await listEnrichment()
    res.json({ map, count: Object.keys(map).length })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to list enrichment' })
  }
})

// Named path before :epic so "import" is never treated as an EPIC id.
app.post('/api/enrichment/import', async (req, res) => {
  try {
    if (!hasDatabase()) return res.status(503).json({ error: 'DATABASE_URL missing' })
    const map = req.body?.map && typeof req.body.map === 'object' ? req.body.map : {}
    const count = await importEnrichmentMap(map)
    broadcast('enrichment_reload', { count })
    res.json({ ok: true, count })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to import enrichment' })
  }
})

app.get('/api/enrichment/:epic', async (req, res) => {
  try {
    if (!hasDatabase()) return res.status(503).json({ error: 'DATABASE_URL missing' })
    const row = await getEnrichment(req.params.epic)
    if (!row) return res.status(404).json({ error: 'Not found' })
    res.json({ epic: String(req.params.epic).toUpperCase(), row })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load enrichment' })
  }
})

app.put('/api/enrichment/:epic', async (req, res) => {
  try {
    if (!hasDatabase()) return res.status(503).json({ error: 'DATABASE_URL missing' })
    const epic = String(req.params.epic).toUpperCase()
    const row = await upsertEnrichment(epic, req.body || {})
    broadcast('enrichment', { epic, row })
    res.json({ epic, row })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to save enrichment' })
  }
})

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  if (typeof res.flushHeaders === 'function') res.flushHeaders()

  // Keep SSE alive behind Render / proxies
  req.socket.setTimeout(0)
  req.socket.setNoDelay?.(true)
  req.socket.setKeepAlive?.(true)

  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, t: Date.now() })}\n\n`)
  sseClients.add(res)

  const ping = setInterval(() => {
    try {
      res.write(`event: ping\ndata: ${JSON.stringify({ t: Date.now() })}\n\n`)
    } catch {
      clearInterval(ping)
      sseClients.delete(res)
    }
  }, 15000)

  const cleanup = () => {
    clearInterval(ping)
    sseClients.delete(res)
  }
  req.on('close', cleanup)
  req.on('error', cleanup)
})

app.use(express.static(dist, { index: false, maxAge: '1h' }))

// Express 5 path-to-regexp requires a named splat (bare "*" crashes on boot).
app.get('/{*spa}', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next()
  res.sendFile(path.join(dist, 'index.html'), (err) => {
    if (err) next(err)
  })
})

async function main() {
  if (hasDatabase()) {
    await migrateWithRetry()
    console.log('[db] migrated voter_enrichment')
  } else {
    console.warn('[db] DATABASE_URL not set — API enrichment disabled')
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`[server] listening on :${port} db=${hasDatabase() ? 'on' : 'off'}`)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
