/** Remote enrichment API (Render Postgres via Express). Falls back when offline. */

let apiAvailable = null

export async function checkEnrichmentApi() {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' })
    if (!res.ok) {
      apiAvailable = false
      return { ok: false, db: false }
    }
    const body = await res.json()
    apiAvailable = Boolean(body?.ok && body?.db)
    return { ok: Boolean(body?.ok), db: Boolean(body?.db), enrichmentCount: body?.enrichmentCount || 0 }
  } catch {
    apiAvailable = false
    return { ok: false, db: false }
  }
}

export function isEnrichmentApiAvailable() {
  return apiAvailable === true
}

export async function fetchEnrichmentMap() {
  const res = await fetch('/api/enrichment', { cache: 'no-store' })
  if (!res.ok) throw new Error(`enrichment fetch failed: ${res.status}`)
  const body = await res.json()
  return body.map && typeof body.map === 'object' ? body.map : {}
}

export async function putEnrichment(epic, patch) {
  const key = String(epic).toUpperCase()
  const res = await fetch(`/api/enrichment/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch || {}),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `enrichment save failed: ${res.status}`)
  }
  return res.json()
}

export async function importEnrichmentMap(map) {
  const res = await fetch('/api/enrichment/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ map: map || {} }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `enrichment import failed: ${res.status}`)
  }
  return res.json()
}

/**
 * Subscribe to enrichment SSE. Returns an unsubscribe function.
 */
export function subscribeEnrichmentEvents(handlers = {}) {
  let source
  try {
    source = new EventSource('/api/events')
  } catch {
    return () => {}
  }

  const onEnrichment = (ev) => {
    try {
      const data = JSON.parse(ev.data)
      handlers.onEnrichment?.(data)
    } catch {
      /* ignore */
    }
  }
  const onReload = (ev) => {
    try {
      const data = JSON.parse(ev.data || '{}')
      handlers.onReload?.(data)
    } catch {
      handlers.onReload?.({})
    }
  }

  source.addEventListener('enrichment', onEnrichment)
  source.addEventListener('enrichment_reload', onReload)
  source.onerror = () => {
    handlers.onError?.()
  }

  return () => {
    source.removeEventListener('enrichment', onEnrichment)
    source.removeEventListener('enrichment_reload', onReload)
    source.close()
  }
}
