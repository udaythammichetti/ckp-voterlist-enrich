/**
 * Save version → update project folder + take as latest.
 *
 * Writes (via Vite API, never touches voters.json):
 *   public/data/versions/voters_enriched_TIMESTAMP.json  (backup)
 *   public/data/voters_latest.prev.json                  (previous latest)
 *   public/data/voters_latest.json                       (active latest)
 *
 * Also mirrors into browser IndexedDB and downloads a copy.
 */

import {
  buildDatasetPayload,
  listDatasetBackups,
  loadDatasetBackup,
  saveLatestDataset,
} from './dataStore'
import { loadEnrichmentMap } from './enrichment'

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Strip UI-only fields before writing a portable JSON version. */
export function serializeVoter(v) {
  const {
    enriched: _e,
    _overridden: _o,
    focusField: _f,
    children: _c,
    linked: _l,
    depth: _d,
    role: _r,
    ...rest
  } = v
  return rest
}

function buildPayload(voters, meta = {}, version) {
  const exportedAt = new Date().toISOString()
  return {
    meta: {
      ...meta,
      sourceFile: 'voters.json',
      versionLabel: `enriched_${version}`,
      exportedAt,
      savedAt: exportedAt,
      electorCount: voters.length,
      projectPath: 'web/public/data/voters_latest.json',
      note: 'Saved into project folder as latest. Original voters.json was not modified.',
      isLatest: true,
    },
    voters: voters.map(serializeVoter),
  }
}

async function persistToProject(payload, version) {
  const res = await fetch('/api/data/save-version', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, meta: payload.meta, voters: payload.voters }),
  })
  let body = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  if (!res.ok || !body?.ok) {
    const msg =
      body?.error ||
      `Project save failed (${res.status}). Run the Vite dev server so /api/data/save-version can write public/data/.`
    const err = new Error(msg)
    err.status = res.status
    throw err
  }
  return body
}

/**
 * Save as latest in the project folder (+ backup + download).
 */
export async function downloadVotersVersion(voters, meta = {}, options = {}) {
  const version = stamp()
  const filename = options.filename || `voters_enriched_${version}.json`
  const payload = buildPayload(voters, meta, version)

  // 1) Project folder is source of truth
  const server = await persistToProject(payload, version)

  // 2) Mirror into browser (previous browser latest → backup)
  await saveLatestDataset(
    buildDatasetPayload(payload.voters, payload.meta, {
      sourceLabel: 'voters_latest.json',
    }),
    { keepBackup: true },
  )

  // 3) User download copy
  if (options.download !== false) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    downloadBlob(filename, blob)
  }

  const backups = await listDatasetBackups()

  return {
    filename: server.filename || filename,
    version,
    savedToDisk: true,
    latestUrl: server.latestUrl || '/data/voters_latest.json',
    previousUrl: server.previousUrl || null,
    versionUrl: server.versionUrl || null,
    backupCount: server.backupCount ?? backups.length,
    browserBackups: backups.length,
    sourceLabel: 'voters_latest.json',
    projectPath: 'web/public/data/voters_latest.json',
  }
}

/**
 * Keep browser working copy in sync after field edits (no project write until Save version).
 */
export async function persistWorkingCopy(voters, meta = {}) {
  const clean = voters.map(serializeVoter)
  await saveLatestDataset(
    buildDatasetPayload(
      clean,
      {
        ...meta,
        exportedAt: new Date().toISOString(),
      },
      {
        sourceLabel: meta.loadedFrom || meta.versionLabel || 'browser working copy',
      },
    ),
    { keepBackup: false },
  )
}

export async function getVersionBackups() {
  const browser = await listDatasetBackups()
  let disk = []
  try {
    const res = await fetch(`/api/data/versions?t=${Date.now()}`, { cache: 'no-store' })
    if (res.ok) {
      const manifest = await res.json()
      disk = (manifest.versions || []).slice(0, 8).map((v) => ({
        id: v.filename,
        savedAt: v.mtime,
        sourceLabel: v.filename,
        electorCount: null,
        url: v.url,
        kind: 'disk',
      }))
    }
  } catch {
    /* api only in vite */
  }
  return {
    browser: browser.map((b) => ({ ...b, kind: 'browser' })),
    disk,
    previousLatestUrl: '/data/voters_latest.prev.json',
  }
}

export async function restoreBrowserBackup(id) {
  const row = await loadDatasetBackup(id)
  if (!row?.voters?.length) throw new Error('Backup not found')
  await saveLatestDataset(
    buildDatasetPayload(row.voters, row.meta || {}, {
      sourceLabel: `restored:${row.sourceLabel || id}`,
    }),
    { keepBackup: true },
  )
  return row
}

/**
 * Compact patch file of only changed EPICs.
 */
export function downloadEnrichmentPatch(options = {}) {
  const version = stamp()
  const map = loadEnrichmentMap()
  const filename = options.filename || `enrichment_patch_${version}.json`
  const payload = {
    meta: {
      kind: 'enrichment_patch',
      versionLabel: `patch_${version}`,
      exportedAt: new Date().toISOString(),
      entryCount: Object.keys(map).length,
      note: 'Overrides only. Apply on top of original voters.json — does not replace the roll file.',
    },
    enrichment: map,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  downloadBlob(filename, blob)
  return { filename, version }
}
