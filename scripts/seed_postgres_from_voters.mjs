#!/usr/bin/env node
/**
 * Drop voter_enrichment and reload from web/public/data/voters.json (or --file).
 *
 * Usage:
 *   DATABASE_URL='postgresql://…' node scripts/seed_postgres_from_voters.mjs
 *   DATABASE_URL='…' node scripts/seed_postgres_from_voters.mjs --file web/public/data/voters_latest.json
 *   DATABASE_URL='…' node scripts/seed_postgres_from_voters.mjs --clear-only
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DEFAULT_FILE = path.join(ROOT, 'web/public/data/voters.json')

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  if (i < 0) return null
  return process.argv[i + 1] || null
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error('DATABASE_URL is required (use Render Postgres External URL from local).')
    process.exit(1)
  }
  // Prefer External SSL from local machines.
  if (!process.env.PGSSL) process.env.PGSSL = 'true'

  const dbPath = path.join(ROOT, 'web/server/db.js')
  const {
    clearEnrichment,
    enrichmentCount,
    migrate,
    replaceEnrichmentFromVoters,
    resetPool,
    validateDatabaseUrl,
  } = await import(pathToFileURL(dbPath).href)

  const check = validateDatabaseUrl()
  if (!check.ok) {
    console.error(check.error)
    process.exit(1)
  }
  console.log(
    `[seed] host=${check.info.host} db=${check.info.database} ssl=${check.info.ssl}`,
  )

  await migrate()
  const before = await enrichmentCount()
  console.log(`[seed] rows before: ${before}`)

  if (process.argv.includes('--clear-only')) {
    await clearEnrichment()
    console.log(`[seed] truncated. rows after: ${await enrichmentCount()}`)
    resetPool()
    return
  }

  const file = path.resolve(argValue('--file') || DEFAULT_FILE)
  const payload = JSON.parse(readFileSync(file, 'utf8'))
  const voters = Array.isArray(payload?.voters) ? payload.voters : []
  if (!voters.length) {
    console.error(`[seed] no voters in ${file}`)
    process.exit(1)
  }

  const count = await replaceEnrichmentFromVoters(voters)
  const after = await enrichmentCount()
  console.log(
    `[seed] loaded ${count} from ${path.relative(ROOT, file)}; table count=${after}`,
  )
  console.log(
    `[seed] meta total=${payload?.meta?.total ?? '?'} wards=${JSON.stringify(payload?.meta?.wards || [])}`,
  )
  resetPool()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
