/** Browser working-copy + backup history. Original voters.json is never overwritten. */

const DB_NAME = 'sarpanch_chukkavaripalli_data'
const DB_VERSION = 2
const STORE = 'datasets'
const LATEST_KEY = 'latest'
const HISTORY_KEY = 'history'
const MAX_BACKUPS = 12

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'))
  })
}

function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'))
  })
}

async function withStore(mode, fn) {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, mode)
    const store = tx.objectStore(STORE)
    return await fn(store)
  } finally {
    db.close()
  }
}

export function datasetTimestamp(row) {
  if (!row) return 0
  const raw =
    row.savedAt ||
    row.meta?.exportedAt ||
    row.meta?.savedAt ||
    row.meta?.loadedAt ||
    ''
  const t = Date.parse(raw)
  return Number.isFinite(t) ? t : 0
}

export async function saveLatestDataset(payload, { keepBackup = true } = {}) {
  return withStore('readwrite', async (store) => {
    const prev = await idbRequest(store.get(LATEST_KEY))
    if (keepBackup && prev?.voters?.length) {
      const history = (await idbRequest(store.get(HISTORY_KEY))) || []
      const entry = {
        id: prev.meta?.versionLabel || prev.sourceLabel || `backup_${Date.now()}`,
        savedAt: prev.savedAt || new Date().toISOString(),
        sourceLabel: prev.sourceLabel || 'previous latest',
        meta: prev.meta || {},
        voters: prev.voters,
        electorCount: prev.voters.length,
      }
      const nextHistory = [entry, ...history.filter((h) => h.id !== entry.id)].slice(0, MAX_BACKUPS)
      await idbRequest(store.put(nextHistory, HISTORY_KEY))
    }
    await idbRequest(
      store.put(
        {
          ...payload,
          savedAt: new Date().toISOString(),
        },
        LATEST_KEY,
      ),
    )
  })
}

export async function loadLatestDataset() {
  try {
    return await withStore('readonly', async (store) => {
      const row = await idbRequest(store.get(LATEST_KEY))
      if (!row?.voters?.length) return null
      return row
    })
  } catch {
    return null
  }
}

export async function listDatasetBackups() {
  try {
    return await withStore('readonly', async (store) => {
      const history = (await idbRequest(store.get(HISTORY_KEY))) || []
      return history.map((h) => ({
        id: h.id,
        savedAt: h.savedAt,
        sourceLabel: h.sourceLabel,
        electorCount: h.electorCount || h.voters?.length || 0,
        versionLabel: h.meta?.versionLabel || '',
      }))
    })
  } catch {
    return []
  }
}

export async function loadDatasetBackup(id) {
  return withStore('readonly', async (store) => {
    const history = (await idbRequest(store.get(HISTORY_KEY))) || []
    return history.find((h) => h.id === id) || null
  })
}

export async function clearLatestDataset() {
  try {
    await withStore('readwrite', async (store) => {
      await idbRequest(store.delete(LATEST_KEY))
      // Keep history backups unless full wipe is desired — clear only active latest
    })
  } catch {
    /* ignore */
  }
}

export async function clearAllDatasets() {
  try {
    await withStore('readwrite', async (store) => {
      await idbRequest(store.delete(LATEST_KEY))
      await idbRequest(store.delete(HISTORY_KEY))
    })
  } catch {
    /* ignore */
  }
}

export function buildDatasetPayload(voters, meta = {}, extra = {}) {
  return {
    meta: {
      ...meta,
      ...extra.meta,
      electorCount: voters.length,
      savedAt: new Date().toISOString(),
      exportedAt: meta.exportedAt || new Date().toISOString(),
    },
    voters,
    sourceLabel: extra.sourceLabel || meta.versionLabel || 'working copy',
  }
}
