import { applyEnrichment } from './enrichment'
import { loadLatestDataset } from './dataStore'

function cleanStr(v) {
  if (v == null || v === '') return ''
  const s = String(v).trim()
  return s === 'nan' || s === 'NaN' ? '' : s
}

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function ageBand(age) {
  if (age == null) return 'Unknown'
  if (age <= 25) return '18–25'
  if (age <= 35) return '26–35'
  if (age <= 45) return '36–45'
  if (age <= 55) return '46–55'
  if (age <= 65) return '56–65'
  return '65+'
}

export function normalizeRow(raw) {
  const age = toNum(raw.age)
  let gender = cleanStr(raw.gender)
  if (gender !== 'Male' && gender !== 'Female') gender = ''

  const ward = toNum(raw.ward ?? raw.part)
  const habitation = cleanStr(raw.habitation || raw.sectionName || raw.section)
  const habitationTe = cleanStr(raw.habitationTe)
  const habitationId = toNum(raw.habitationId ?? raw.sectionNo)
  const section = habitation || 'Unmapped village'
  const sectionNo = habitationId != null ? String(habitationId) : cleanStr(raw.sectionNo)
  const sectionName = habitation || cleanStr(raw.sectionName) || 'Unmapped village'

  return {
    part: ward,
    ward,
    constituency: cleanStr(raw.constituency) || '173 - Puthalapattu',
    constituencyLabel: cleanStr(raw.constituencyLabel || raw.constituency) || '173 - Puthalapattu',
    parliamentaryConstituency: cleanStr(raw.parliamentaryConstituency) || '',
    district: cleanStr(raw.district) || 'Chittoor',
    subdivision: cleanStr(raw.subdivision) || '',
    tehsilMandal: cleanStr(raw.tehsilMandal || raw.mandal) || 'Irala',
    mainTown: cleanStr(raw.mainTown || raw.panchayat) || 'Chukkavaripalli',
    panchayat: cleanStr(raw.panchayat) || 'Sarpanch Elections Chukkavaripalli',
    postOffice: cleanStr(raw.postOffice) || '',
    policeStation: cleanStr(raw.policeStation) || '',
    pinCode: cleanStr(raw.pinCode) || '',
    pollingStationName: cleanStr(raw.pollingStationName) || (ward != null ? `Ward ${ward}` : ''),
    pollingStationAddress: cleanStr(raw.pollingStationAddress) || '',
    pollingStationType: cleanStr(raw.pollingStationType) || '',
    yearOfRevision: cleanStr(raw.yearOfRevision) || '2026',
    qualifyingDate: cleanStr(raw.qualifyingDate) || '',
    typeOfRevision: cleanStr(raw.typeOfRevision) || 'GP Elections 2026',
    dateOfPublication: cleanStr(raw.dateOfPublication) || '',
    habitation,
    habitationTe,
    habitationId,
    section,
    sectionNo,
    sectionName,
    sectionKey: `W:${ward ?? 'x'}|V:${habitationId ?? habitation ?? 'unknown'}`,
    sectionPath: `/villages/${encodeURIComponent(habitationId ?? habitation ?? 'unknown')}`,
    serial: toNum(raw.serial),
    serialRaw: cleanStr(raw.serial),
    assemblySerial: cleanStr(raw.assemblySerial),
    epic: cleanStr(raw.epic).toUpperCase(),
    name: cleanStr(raw.name),
    nameTe: cleanStr(raw.nameTe),
    relationType: cleanStr(raw.relationType),
    relationName: cleanStr(raw.relationName),
    relationNameTe: cleanStr(raw.relationNameTe),
    house: cleanStr(raw.house),
    age,
    ageBand: ageBand(age),
    gender,
    page: toNum(raw.page) ?? 0,
    phone: cleanStr(raw.phone),
    currentAddress: cleanStr(raw.currentAddress),
    notes: cleanStr(raw.notes),
    voterStatus: cleanStr(raw.voterStatus),
    photo: cleanStr(raw.photo),
    source: cleanStr(raw.source) || 'vedagirivaripalle 2026voterlist.pdf',
  }
}

function normalizePayload(data, sourceLabel = 'voters.json') {
  const rows = Array.isArray(data) ? data : data.voters || []
  const meta = Array.isArray(data) ? {} : { ...(data.meta || {}) }
  const normalized = rows.map(normalizeRow).filter((r) => r.epic || r.name)
  normalized.sort((a, b) => {
    const sa = a.serial ?? 1e9
    const sb = b.serial ?? 1e9
    return sa - sb
  })
  return {
    voters: applyEnrichment(normalized),
    meta: {
      ...meta,
      loadedFrom: sourceLabel,
      loadedAt: new Date().toISOString(),
    },
    sourceLabel,
  }
}

export async function loadVotersFromJson(url = '/data/voters.json', sourceLabel) {
  const sep = url.includes('?') ? '&' : '?'
  const res = await fetch(`${url}${sep}t=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Failed to load voters: ${res.status}`)
  const data = await res.json()
  const label =
    sourceLabel ||
    (url.includes('voters_latest')
      ? 'voters_latest.json'
      : url.includes('/versions/')
        ? url.split('/').pop()
        : 'voters.json')
  return normalizePayload(data, label)
}

export function loadVotersFromObject(data, sourceLabel = 'imported file') {
  return normalizePayload(data, sourceLabel)
}

async function tryFetchJson(url) {
  try {
    const sep = url.includes('?') ? '&' : '?'
    const res = await fetch(`${url}${sep}t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/**
 * Project folder is source of truth after Save version:
 *   1) public/data/voters_latest.json
 *   2) newest file in public/data/versions/
 *   3) browser working copy (unsaved edits)
 *   4) original voters.json
 */
export async function loadBestVoters() {
  // 1) Project latest (written by Save version)
  const latestFile = await tryFetchJson('/data/voters_latest.json')
  if (latestFile && (latestFile.voters?.length || Array.isArray(latestFile))) {
    return normalizePayload(latestFile, 'voters_latest.json')
  }

  // 2) Newest dated backup in project versions/
  const manifest = await tryFetchJson('/data/versions/manifest.json')
  const latestName = manifest?.latest || manifest?.versions?.[0]?.filename
  if (latestName) {
    const versionData = await tryFetchJson(`/data/versions/${latestName}`)
    if (versionData && (versionData.voters?.length || Array.isArray(versionData))) {
      return normalizePayload(versionData, latestName)
    }
  }

  // 3) Browser working copy (edits not yet saved to project)
  const idb = await loadLatestDataset()
  if (idb?.voters?.length) {
    return normalizePayload(
      { meta: idb.meta || {}, voters: idb.voters },
      idb.sourceLabel || 'browser working copy',
    )
  }

  // 4) Original extract — never overwritten by Save version
  return loadVotersFromJson('/data/voters.json', 'voters.json')
}

/** @deprecated use loadVotersFromJson */
export async function loadVotersFromExcel(url) {
  const { voters } = await loadVotersFromJson(url?.includes('.json') ? url : '/data/voters.json')
  return voters
}

function rollup(voters, keyFn, labelFn) {
  const map = new Map()
  for (const v of voters) {
    const key = keyFn(v)
    if (!map.has(key)) {
      map.set(key, {
        key,
        label: labelFn(v),
        total: 0,
        male: 0,
        female: 0,
        avgAgeSum: 0,
        ageCount: 0,
        youth: 0,
        senior: 0,
        houses: new Set(),
        part: v.part,
        ward: v.ward,
        sectionNo: v.sectionNo,
        sectionName: v.sectionName,
        section: v.section,
        habitation: v.habitation,
        habitationTe: v.habitationTe,
        habitationId: v.habitationId,
        district: v.district,
        tehsilMandal: v.tehsilMandal,
        pollingStationName: v.pollingStationName,
        constituency: v.constituency,
        withPhone: 0,
        withAddress: 0,
      })
    }
    const row = map.get(key)
    row.total += 1
    if (v.gender === 'Male') row.male += 1
    if (v.gender === 'Female') row.female += 1
    if (v.age != null) {
      row.avgAgeSum += v.age
      row.ageCount += 1
      if (v.age < 35) row.youth += 1
      if (v.age >= 60) row.senior += 1
    }
    if (v.house) row.houses.add(String(v.house).toLowerCase())
    if (v.phone) row.withPhone += 1
    if (v.currentAddress) row.withAddress += 1
  }
  return [...map.values()]
    .map((r) => {
      const { houses, ...rest } = r
      return {
        ...rest,
        households: houses.size,
        avgAge: r.ageCount ? Math.round((r.avgAgeSum / r.ageCount) * 10) / 10 : 0,
        femaleShare: r.total ? Math.round((r.female / r.total) * 1000) / 10 : 0,
        youthPct: r.total ? Math.round((r.youth / r.total) * 1000) / 10 : 0,
      }
    })
    .sort((a, b) => {
      if (a.ward !== b.ward) return (a.ward ?? 0) - (b.ward ?? 0)
      return Number(a.habitationId || 0) - Number(b.habitationId || 0)
    })
}

export function computeStats(voters) {
  const total = voters.length
  const male = voters.filter((v) => v.gender === 'Male').length
  const female = voters.filter((v) => v.gender === 'Female').length
  const unknownGender = total - male - female
  const ages = voters.map((v) => v.age).filter((a) => a != null)
  const avgAge = ages.length
    ? Math.round((ages.reduce((s, a) => s + a, 0) / ages.length) * 10) / 10
    : 0

  const parts = rollup(
    voters,
    (v) => String(v.ward ?? v.part ?? 0),
    (v) => `Ward ${v.ward ?? v.part ?? '—'}`,
  ).map((p) => ({ ...p, part: p.ward ?? p.part }))

  const sections = rollup(
    voters,
    (v) => v.sectionKey,
    (v) => v.habitation || v.section || 'Unmapped village',
  )

  const bandOrder = ['18–25', '26–35', '36–45', '46–55', '56–65', '65+', 'Unknown']
  const bandCounts = Object.fromEntries(bandOrder.map((b) => [b, 0]))
  for (const v of voters) bandCounts[v.ageBand] = (bandCounts[v.ageBand] || 0) + 1
  const ageBandRows = bandOrder
    .filter((b) => bandCounts[b] > 0)
    .map((b) => ({ band: b, count: bandCounts[b] }))
  const ageMax = Math.max(1, ...ageBandRows.map((b) => b.count))
  const ageBands = ageBandRows.map((b) => ({
    ...b,
    pct: total ? Math.round((b.count / total) * 1000) / 10 : 0,
    bar: Math.round((b.count / ageMax) * 100),
  }))

  const youth = voters.filter((v) => v.age != null && v.age < 35).length
  const senior = voters.filter((v) => v.age != null && v.age >= 60).length
  const withSerial = voters.filter((v) => v.serial != null).length
  const withEpic = voters.filter((v) => v.epic).length
  const withHouse = voters.filter((v) => v.house).length
  const withSection = voters.filter((v) => v.habitation).length
  const withAge = voters.filter((v) => v.age != null).length
  const withGender = voters.filter((v) => v.gender).length
  const withRelation = voters.filter((v) => v.relationType && v.relationName).length
  const withPhone = voters.filter((v) => v.phone).length
  const withAddress = voters.filter((v) => v.currentAddress).length
  const withNotes = voters.filter((v) => v.notes).length
  const withStatus = voters.filter((v) => v.voterStatus).length
  const withPhoto = voters.filter((v) => v.photo).length
  const enrichedCount = voters.filter(
    (v) => v.phone || v.currentAddress || v.notes || v.voterStatus,
  ).length
  const statusCounts = {}
  for (const v of voters) {
    const k = v.voterStatus || 'unset'
    statusCounts[k] = (statusCounts[k] || 0) + 1
  }
  const coveragePct = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0)

  const sample = voters[0] || {}
  return {
    constituency: sample.constituency || '173 - Puthalapattu',
    constituencyLabel: sample.constituencyLabel || sample.constituency || '173 - Puthalapattu',
    parliamentaryConstituency: sample.parliamentaryConstituency || '',
    district: sample.district || 'Chittoor',
    subdivision: sample.subdivision || '',
    tehsilMandal: sample.tehsilMandal || 'Irala',
    pinCode: sample.pinCode || '',
    panchayat: sample.panchayat || 'Sarpanch Elections Chukkavaripalli',
    qualifyingDate: sample.qualifyingDate || '',
    dateOfPublication: sample.dateOfPublication || '',
    typeOfRevision: sample.typeOfRevision || 'GP Elections 2026',
    yearOfRevision: sample.yearOfRevision || '2026',
    total,
    male,
    female,
    unknownGender,
    avgAge,
    partsCount: parts.length,
    sectionsCount: new Set(voters.map((v) => v.habitationId ?? v.habitation).filter(Boolean)).size,
    wardsCount: parts.length,
    villagesCount: new Set(voters.map((v) => v.habitationId ?? v.habitation).filter(Boolean)).size,
    youth,
    senior,
    youthPct: total ? Math.round((youth / total) * 1000) / 10 : 0,
    femalePct: total ? Math.round((female / total) * 1000) / 10 : 0,
    withPhone,
    withAddress,
    withNotes,
    withStatus,
    withPhoto,
    enrichedCount,
    statusCounts,
    enrichedPct: coveragePct(enrichedCount),
    serialCoverage: withSerial,
    serialCoveragePct: coveragePct(withSerial),
    fieldCoverage: [
      { field: 'S.No', count: withSerial, pct: coveragePct(withSerial) },
      { field: 'EPIC / Voter ID', count: withEpic, pct: coveragePct(withEpic) },
      { field: 'Village', count: withSection, pct: coveragePct(withSection) },
      { field: 'House', count: withHouse, pct: coveragePct(withHouse) },
      { field: 'Age', count: withAge, pct: coveragePct(withAge) },
      { field: 'Gender', count: withGender, pct: coveragePct(withGender) },
      { field: 'Relation', count: withRelation, pct: coveragePct(withRelation) },
      { field: 'Photo (from PDF)', count: withPhoto, pct: coveragePct(withPhoto) },
      { field: 'Phone (enriched)', count: withPhone, pct: coveragePct(withPhone) },
      { field: 'Address (enriched)', count: withAddress, pct: coveragePct(withAddress) },
      { field: 'Status (enriched)', count: withStatus, pct: coveragePct(withStatus) },
      { field: 'Notes (enriched)', count: withNotes, pct: coveragePct(withNotes) },
    ],
    parts,
    sections,
    wards: parts,
    villages: sections,
    ageBands,
    pcs: optionCounts(voters, (v) => v.parliamentaryConstituency || '—'),
    pollingStations: optionCounts(voters, (v) => normalizeStationKey(v.pollingStationName)),
  }
}

export function normalizeStationKey(name) {
  const raw = String(name || '').trim()
  if (!raw) return 'Unmapped station'
  return raw.replace(/^\d+\s*[-–]\s*/, '').replace(/\s+/g, ' ').trim() || 'Unmapped station'
}

function optionCounts(voters, keyFn) {
  const map = new Map()
  for (const v of voters) {
    const key = String(keyFn(v) || '').trim() || '—'
    map.set(key, (map.get(key) || 0) + 1)
  }
  return [...map.entries()]
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
}

export function filterVoters(
  voters,
  {
    q = '',
    part = null,
    sectionNo = '',
    section = '',
    gender = '',
    ageBand = '',
    pcs = [],
    pollingStations = [],
    enrichedOnly = false,
    voterStatus = '',
  } = {},
) {
  const query = q.trim().toLowerCase()
  const pcSet = pcs?.length ? new Set(pcs) : null
  const psSet = pollingStations?.length ? new Set(pollingStations) : null
  return voters.filter((v) => {
    if (part != null && part !== '' && Number(v.part) !== Number(part) && Number(v.ward) !== Number(part)) {
      return false
    }
    if (voterStatus === 'unset' && v.voterStatus) return false
    if (voterStatus && voterStatus !== 'unset' && v.voterStatus !== voterStatus) return false
    if (section !== '') {
      if (
        String(v.section) !== String(section) &&
        decodeURIComponent(String(section)) !== v.section &&
        String(v.habitation) !== String(section) &&
        String(v.habitationId) !== String(section)
      ) {
        return false
      }
    } else if (sectionNo !== '' && String(v.sectionNo) !== String(sectionNo) && String(v.habitationId) !== String(sectionNo)) {
      return false
    }
    if (gender && v.gender !== gender) return false
    if (ageBand && v.ageBand !== ageBand) return false
    if (enrichedOnly && !(v.phone || v.currentAddress || v.notes || v.voterStatus)) return false
    if (pcSet && !pcSet.has(v.parliamentaryConstituency || '—')) return false
    if (psSet) {
      const norm = normalizeStationKey(v.pollingStationName)
      const raw = String(v.pollingStationName || '').trim()
      if (!psSet.has(norm) && !(raw && psSet.has(raw))) return false
    }
    if (!query) return true
    const stationNorm = normalizeStationKey(v.pollingStationName).toLowerCase()
    const serialHit =
      (v.serial != null && String(v.serial) === query) ||
      (v.serialRaw && v.serialRaw.toLowerCase().includes(query))
    return (
      serialHit ||
      v.name.toLowerCase().includes(query) ||
      (v.nameTe || '').includes(query) ||
      v.epic.toLowerCase().includes(query) ||
      v.house.toLowerCase().includes(query) ||
      v.relationName.toLowerCase().includes(query) ||
      (v.habitation || '').toLowerCase().includes(query) ||
      (v.sectionName || '').toLowerCase().includes(query) ||
      (v.phone || '').includes(query) ||
      (v.currentAddress || '').toLowerCase().includes(query) ||
      (v.pollingStationName || '').toLowerCase().includes(query) ||
      stationNorm.includes(query)
    )
  })
}
