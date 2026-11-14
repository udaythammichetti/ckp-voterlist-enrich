import pg from 'pg'

const { Pool } = pg

let pool = null

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL?.trim())
}

/** Safe host log (no password). */
export function databaseHostInfo() {
  const raw = process.env.DATABASE_URL?.trim()
  if (!raw) return { configured: false }
  try {
    const u = new URL(raw)
    return {
      configured: true,
      host: u.hostname,
      port: u.port || '5432',
      database: u.pathname?.replace(/^\//, '') || '',
      ssl: shouldUseSsl(raw),
      likelyInternal: !u.hostname.includes('render.com'),
    }
  } catch {
    return { configured: true, host: '(unparseable)', ssl: true, likelyInternal: false }
  }
}

/**
 * Render Internal URL host has no "render.com" and does not need TLS.
 * External URL host ends with "*.render.com" and requires TLS.
 * Override with PGSSL=true|false if needed.
 */
function shouldUseSsl(connectionString) {
  if (process.env.PGSSL === 'false') return false
  if (process.env.PGSSL === 'true') return true
  try {
    const u = new URL(connectionString)
    const host = u.hostname || ''
    const sslmode = (u.searchParams.get('sslmode') || '').toLowerCase()
    if (sslmode === 'disable') return false
    if (sslmode === 'require' || sslmode === 'verify-ca' || sslmode === 'verify-full') return true
    // External Render host → SSL. Internal private host → no SSL.
    if (host.includes('render.com')) return true
    return false
  } catch {
    return true
  }
}

export function resetPool() {
  if (!pool) return
  const old = pool
  pool = null
  old.end().catch(() => {})
}

export function getPool() {
  if (!hasDatabase()) return null
  if (!pool) {
    const connectionString = process.env.DATABASE_URL.trim()
    const useSsl = shouldUseSsl(connectionString)
    const info = databaseHostInfo()
    console.log(
      `[db] connecting host=${info.host} port=${info.port} ssl=${useSsl} internal=${info.likelyInternal}`,
    )
    pool = new Pool({
      connectionString,
      ssl: useSsl ? { rejectUnauthorized: false } : false,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 30000,
      keepAlive: true,
    })
    pool.on('error', (err) => {
      console.error('[db] pool error', err.message || err)
    })
  }
  return pool
}

export async function migrate() {
  const db = getPool()
  if (!db) return false
  await db.query(`
    CREATE TABLE IF NOT EXISTS voter_enrichment (
      epic TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      relation_type TEXT NOT NULL DEFAULT '',
      relation_name TEXT NOT NULL DEFAULT '',
      house TEXT NOT NULL DEFAULT '',
      age INTEGER,
      gender TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      current_address TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      voter_status TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS voter_enrichment_updated_at_idx
      ON voter_enrichment (updated_at DESC);
  `)
  await db.query(`
    ALTER TABLE voter_enrichment ADD COLUMN IF NOT EXISTS age INTEGER;
    ALTER TABLE voter_enrichment ADD COLUMN IF NOT EXISTS gender TEXT NOT NULL DEFAULT '';
  `)
  return true
}

function rowToClient(row) {
  if (!row) return null
  return {
    name: row.name || '',
    relationType: row.relation_type || '',
    relationName: row.relation_name || '',
    house: row.house || '',
    age: row.age == null ? null : Number(row.age),
    gender: row.gender || '',
    phone: row.phone || '',
    currentAddress: row.current_address || '',
    notes: row.notes || '',
    voterStatus: row.voter_status || '',
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
  }
}

export async function listEnrichment() {
  const db = getPool()
  if (!db) return {}
  const { rows } = await db.query('SELECT * FROM voter_enrichment ORDER BY epic')
  const map = {}
  for (const row of rows) {
    map[String(row.epic).toUpperCase()] = rowToClient(row)
  }
  return map
}

export async function getEnrichment(epic) {
  const db = getPool()
  if (!db) return null
  const key = String(epic).toUpperCase()
  const { rows } = await db.query('SELECT * FROM voter_enrichment WHERE epic = $1', [key])
  return rowToClient(rows[0])
}

export async function upsertEnrichment(epic, patch = {}) {
  const db = getPool()
  if (!db) throw new Error('DATABASE_URL is not configured')
  const key = String(epic).toUpperCase()
  const prev = (await getEnrichment(key)) || {
    name: '',
    relationType: '',
    relationName: '',
    house: '',
    age: null,
    gender: '',
    phone: '',
    currentAddress: '',
    notes: '',
    voterStatus: '',
  }
  const nextAge =
    patch.age !== undefined
      ? patch.age === null || patch.age === ''
        ? null
        : Number(patch.age)
      : prev.age
  const next = {
    name: patch.name !== undefined ? String(patch.name || '') : prev.name,
    relationType:
      patch.relationType !== undefined ? String(patch.relationType || '') : prev.relationType,
    relationName:
      patch.relationName !== undefined ? String(patch.relationName || '') : prev.relationName,
    house: patch.house !== undefined ? String(patch.house || '') : prev.house,
    age: Number.isFinite(nextAge) ? nextAge : null,
    gender: patch.gender !== undefined ? String(patch.gender || '') : prev.gender,
    phone: patch.phone !== undefined ? String(patch.phone || '') : prev.phone,
    currentAddress:
      patch.currentAddress !== undefined
        ? String(patch.currentAddress || '')
        : prev.currentAddress,
    notes: patch.notes !== undefined ? String(patch.notes || '') : prev.notes,
    voterStatus:
      patch.voterStatus !== undefined ? String(patch.voterStatus || '') : prev.voterStatus,
  }

  const { rows } = await db.query(
    `
    INSERT INTO voter_enrichment (
      epic, name, relation_type, relation_name, house, age, gender,
      phone, current_address, notes, voter_status, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
    ON CONFLICT (epic) DO UPDATE SET
      name = EXCLUDED.name,
      relation_type = EXCLUDED.relation_type,
      relation_name = EXCLUDED.relation_name,
      house = EXCLUDED.house,
      age = EXCLUDED.age,
      gender = EXCLUDED.gender,
      phone = EXCLUDED.phone,
      current_address = EXCLUDED.current_address,
      notes = EXCLUDED.notes,
      voter_status = EXCLUDED.voter_status,
      updated_at = NOW()
    RETURNING *
    `,
    [
      key,
      next.name,
      next.relationType,
      next.relationName,
      next.house,
      next.age,
      next.gender,
      next.phone,
      next.currentAddress,
      next.notes,
      next.voterStatus,
    ],
  )
  return rowToClient(rows[0])
}

export async function importEnrichmentMap(map = {}) {
  const db = getPool()
  if (!db) throw new Error('DATABASE_URL is not configured')
  let count = 0
  for (const [epic, row] of Object.entries(map)) {
    if (!epic) continue
    await upsertEnrichment(epic, row || {})
    count += 1
  }
  return count
}

export async function enrichmentCount() {
  const db = getPool()
  if (!db) return 0
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM voter_enrichment')
  return rows[0]?.n || 0
}
