/** Persist voter field overrides in localStorage (never writes to voters.json). */

const STORAGE_KEY = 'sarpanch_chukkavaripalli_enrichment_v2'
const LEGACY_KEYS = [
  'sarpanch_chukkavaripalli_enrichment_v1',
  'ckp_voter_enrichment_v2',
  'ckp_voter_enrichment_v1',
]

export const RELATION_TYPES = ['', 'Father', 'Mother', 'Husband', 'Other']
export const GENDER_OPTIONS = ['', 'Male', 'Female']

/**
 * Campaign field statuses.
 * group: positive | soft_positive | pipeline | negative | field | unset
 */
export const VOTER_STATUSES = [
  { value: '', label: 'Not set', group: 'unset' },
  { value: 'supporter', label: 'Supporter', group: 'positive' },
  { value: 'family_support', label: 'Family support', group: 'soft_positive' },
  { value: 'pledged', label: 'Pledged / will vote', group: 'soft_positive' },
  { value: 'contacted', label: 'Contacted', group: 'pipeline' },
  { value: 'undecided', label: 'Undecided', group: 'pipeline' },
  { value: 'not_contacted', label: 'Not contacted', group: 'pipeline' },
  { value: 'not_supporter', label: 'Not supporter', group: 'negative' },
  { value: 'opposed', label: 'Opposed', group: 'negative' },
  { value: 'rival', label: 'Rival / other side', group: 'negative' },
  { value: 'needs_visit', label: 'Needs visit', group: 'field' },
  { value: 'nr', label: 'Not reachable', group: 'field' },
  { value: 'out_of_station', label: 'Out of station', group: 'field' },
  { value: 'shifted', label: 'Shifted / moved', group: 'field' },
]

export const STATUS_GROUPS = {
  positive: 'Supporters',
  soft_positive: 'Family / pledged',
  pipeline: 'Pipeline',
  negative: 'Not supporters',
  field: 'Field follow-up',
  unset: 'Not set',
}

export function statusMeta(value) {
  const key = value || ''
  const found = VOTER_STATUSES.find((s) => s.value === key)
  if (found) return found
  // Legacy values (removed from picker, still counted if already saved)
  if (key === 'firm_supporter') return { value: key, label: 'Firm supporter', group: 'positive' }
  if (key === 'leaning') return { value: key, label: 'Leaning', group: 'soft_positive' }
  return { value: key, label: key || 'Not set', group: 'unset' }
}

/** Fields that can be updated in the elector detail form. */
export const EDITABLE_FIELDS = [
  'name',
  'relationType',
  'relationName',
  'house',
  'phone',
  'currentAddress',
  'voterStatus',
  'notes',
]

export function statusLabel(value) {
  return statusMeta(value).label || value || 'Not set'
}

export function computeAgeBand(age) {
  if (age == null || age === '') return 'Unknown'
  const n = Number(age)
  if (!Number.isFinite(n)) return 'Unknown'
  if (n <= 25) return '18–25'
  if (n <= 35) return '26–35'
  if (n <= 45) return '36–45'
  if (n <= 55) return '46–55'
  if (n <= 65) return '56–65'
  return '65+'
}

function normalizeAge(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function emptyEnrichment() {
  return {
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
}

function coerceRow(row = {}) {
  const base = emptyEnrichment()
  return {
    ...base,
    name: row.name != null ? String(row.name) : '',
    relationType: row.relationType != null ? String(row.relationType) : '',
    relationName: row.relationName != null ? String(row.relationName) : '',
    house: row.house != null ? String(row.house) : '',
    age: normalizeAge(row.age),
    gender: row.gender != null ? String(row.gender) : '',
    phone: row.phone != null ? String(row.phone) : '',
    currentAddress: row.currentAddress != null ? String(row.currentAddress) : '',
    notes: row.notes != null ? String(row.notes) : '',
    voterStatus: row.voterStatus != null ? String(row.voterStatus) : '',
    updatedAt: row.updatedAt || undefined,
  }
}

export function loadEnrichmentMap() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const obj = JSON.parse(raw)
      if (obj && typeof obj === 'object') return obj
    }
    for (const key of LEGACY_KEYS) {
      const legacy = localStorage.getItem(key)
      if (!legacy) continue
      try {
        const obj = JSON.parse(legacy)
        if (obj && typeof obj === 'object') {
          localStorage.setItem(STORAGE_KEY, legacy)
          return obj
        }
      } catch {
        /* ignore */
      }
    }
    return {}
  } catch {
    return {}
  }
}

export function saveEnrichmentMap(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* ignore quota */
  }
}

export function getEnrichment(epic) {
  if (!epic) return emptyEnrichment()
  const map = loadEnrichmentMap()
  return coerceRow(map[String(epic).toUpperCase()] || {})
}

export function setEnrichment(epic, patch) {
  if (!epic) return emptyEnrichment()
  const key = String(epic).toUpperCase()
  const map = loadEnrichmentMap()
  const prev = coerceRow(map[key] || {})
  const next = { ...prev }

  for (const field of EDITABLE_FIELDS) {
    if (patch[field] === undefined) continue
    if (field === 'age') {
      next.age = normalizeAge(patch.age)
    } else {
      next[field] = patch[field] != null ? String(patch[field]) : ''
    }
  }
  next.updatedAt = new Date().toISOString()
  map[key] = next
  saveEnrichmentMap(map)
  return next
}

function hasOverride(row) {
  return EDITABLE_FIELDS.some((field) => {
    const val = row[field]
    if (field === 'age') return val != null && val !== ''
    return Boolean(val)
  })
}

export function isEnriched(row) {
  return Boolean(
    row.phone ||
      row.currentAddress ||
      row.notes ||
      row.voterStatus ||
      row._overridden,
  )
}

/**
 * Apply saved overrides on top of roll data.
 * Empty override string means "keep original" for roll identity fields;
 * phone/address/notes/status may clear to empty when explicitly saved.
 */
export function applyEnrichment(voters, mapOverride = null) {
  const map = mapOverride && typeof mapOverride === 'object' ? mapOverride : loadEnrichmentMap()
  return voters.map((v) => {
    const extra = coerceRow(map[String(v.epic || '').toUpperCase()] || {})
    const overridden = {}

    if (extra.name) overridden.name = extra.name
    if (extra.relationType) overridden.relationType = extra.relationType
    if (extra.relationName) overridden.relationName = extra.relationName
    if (extra.house) overridden.house = extra.house
    if (extra.gender) overridden.gender = extra.gender
    if (extra.age != null) {
      overridden.age = extra.age
      overridden.ageBand = computeAgeBand(extra.age)
    }

    // Contact fields: if epic has any saved enrichment row, prefer saved values
    // (including blanks) only when the key exists in storage with updates.
    const hasSaved = Boolean(map[String(v.epic || '').toUpperCase()])
    if (hasSaved) {
      overridden.phone = extra.phone
      overridden.currentAddress = extra.currentAddress
      overridden.notes = extra.notes
      overridden.voterStatus = extra.voterStatus
    }

    const merged = { ...v, ...overridden }
    const _overridden = hasOverride(extra)
    return { ...merged, enriched: isEnriched(merged) || _overridden, _overridden }
  })
}

/** Merge one remote row into localStorage map (keeps offline cache in sync). */
export function mergeEnrichmentRow(epic, row) {
  if (!epic) return loadEnrichmentMap()
  const key = String(epic).toUpperCase()
  const map = loadEnrichmentMap()
  map[key] = coerceRow(row || {})
  saveEnrichmentMap(map)
  return map
}

export function replaceEnrichmentMap(map) {
  const next = {}
  if (map && typeof map === 'object') {
    for (const [epic, row] of Object.entries(map)) {
      if (!epic) continue
      next[String(epic).toUpperCase()] = coerceRow(row || {})
    }
  }
  saveEnrichmentMap(next)
  return next
}

export function enrichmentStats(voters) {
  const withPhone = voters.filter((v) => v.phone).length
  const withAddress = voters.filter((v) => v.currentAddress).length
  const withNotes = voters.filter((v) => v.notes).length
  const withStatus = voters.filter((v) => v.voterStatus).length
  const withOverrides = voters.filter((v) => v._overridden || isEnriched(v)).length
  const byStatus = {}
  for (const v of voters) {
    const key = v.voterStatus || 'unset'
    byStatus[key] = (byStatus[key] || 0) + 1
  }
  return {
    withPhone,
    withAddress,
    withNotes,
    withStatus,
    withEither: withOverrides,
    byStatus,
  }
}

export function countEnrichmentEntries() {
  return Object.keys(loadEnrichmentMap()).length
}
