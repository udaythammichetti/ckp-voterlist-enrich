import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  authEnabled,
  checkCredentials,
  clearSessionCookie,
  createSessionToken,
  isAuthenticated,
  loginPageHtml,
  setSessionCookie,
} from './auth.js'
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
  validateDatabaseUrl,
} from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const dist = path.join(root, 'dist')
const port = Number(process.env.PORT) || 4173

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(express.json({ limit: '4mb' }))
app.use(express.urlencoded({ extended: false }))

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
  const check = validateDatabaseUrl()
  if (!check.ok) {
    console.error(`[db] ${check.error}`)
    throw new Error(check.error)
  }

  const info = check.info
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

function wantsHtml(req) {
  const accept = String(req.headers.accept || '')
  return accept.includes('text/html') || req.method === 'GET'
}

function requireAuth(req, res, next) {
  if (!authEnabled() || isAuthenticated(req)) return next()
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Sign in required' })
  }
  const nextUrl = req.originalUrl || '/'
  return res.redirect(302, `/login?next=${encodeURIComponent(nextUrl)}`)
}

// Public health for Render (no auth).
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
  res.json({
    ok: true,
    db: dbOk,
    enrichmentCount: count,
    auth: authEnabled(),
  })
})

app.get('/login', (req, res) => {
  if (!authEnabled()) return res.redirect('/')
  if (isAuthenticated(req)) return res.redirect('/')
  const next = typeof req.query.next === 'string' ? req.query.next : '/'
  res.type('html').send(loginPageHtml({ next }))
})

app.post('/login', (req, res) => {
  if (!authEnabled()) return res.redirect('/')
  const username = String(req.body?.username || '')
  const password = String(req.body?.password || '')
  const nextRaw = String(req.body?.next || '/')
  const next = nextRaw.startsWith('/') ? nextRaw : '/'

  if (!checkCredentials(username, password)) {
    return res
      .status(401)
      .type('html')
      .send(loginPageHtml({ error: 'Invalid username or password', next }))
  }

  setSessionCookie(res, createSessionToken(username))
  return res.redirect(302, next)
})

app.post('/logout', (req, res) => {
  clearSessionCookie(res)
  if (wantsHtml(req)) return res.redirect('/login')
  return res.json({ ok: true })
})

app.get('/logout', (_req, res) => {
  clearSessionCookie(res)
  res.redirect('/login')
})

// Everything below requires auth when AUTH_USER + AUTH_PASSWORD are set.
app.use(requireAuth)

app.get('/api/enrichment', async (_req, res) => {
  try {
    if (!hasDatabase()) return res.status(503).json({ error: 'DATABASE_URL missing' })
    const map = await listEnrichment()
    res.json({ map, count: Object.keys(map).length })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to list enrichment' })
  }
})

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

  if (authEnabled()) {
    console.log('[auth] login required (AUTH_USER / AUTH_PASSWORD)')
  } else {
    console.warn('[auth] AUTH_USER/AUTH_PASSWORD not set — site is open')
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`[server] listening on :${port} db=${hasDatabase() ? 'on' : 'off'}`)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
