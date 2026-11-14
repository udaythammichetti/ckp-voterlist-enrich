/** Extract + data-quality validation for the Chukkavaripalli voter roll. */

/** Cover-page expectations from the 2026 GP PDF. */
export const EXPECTED = {
  total: 1141,
  male: 570,
  female: 571,
  other: 0,
  wards: 8,
  habitationCount: 11,
  serialMin: 1,
  serialMax: 1141,
  wardElectors: {
    1: 142,
    2: 142,
    3: 142,
    4: 142,
    5: 142,
    6: 142,
    7: 142,
    8: 147,
  },
  habitations: [
    { id: 1, name: 'Kotta Venkata Ramapuram', from: 1, to: 1 },
    { id: 2, name: 'Diguvva Nagulavaripalli', from: 2, to: 80 },
    { id: 3, name: 'Eguva Nagulavaripalli', from: 81, to: 122 },
    { id: 4, name: 'Gutta Palyam', from: 123, to: 162 },
    { id: 5, name: 'Vedagirivaripalli', from: 163, to: 315 },
    { id: 6, name: 'Singam Setti Harijanawada', from: 316, to: 388 },
    { id: 7, name: 'Chukkavaripalli', from: 389, to: 694 },
    { id: 8, name: 'Chukkavaripalli ST Colony', from: 695, to: 804 },
    { id: 9, name: 'Eguva Gubalavaripalli', from: 805, to: 1021 },
    { id: 10, name: 'Arundhatiwada', from: 1022, to: 1076 },
    { id: 11, name: 'Diguvva Gubalavaripalli', from: 1077, to: 1141 },
  ],
}

const EPIC_RE = /^[A-Z]{3}\d{7}$/

function pct(n, total) {
  if (!total) return 0
  return Math.round((n / total) * 1000) / 10
}

function serialAnalysis(serials) {
  const nums = serials.filter((n) => Number.isFinite(n)).map(Number).sort((a, b) => a - b)
  if (!nums.length) {
    return { min: null, max: null, count: 0, gaps: [], gapCount: 0, dups: [], dupCount: 0 }
  }
  const seen = new Map()
  for (const n of nums) seen.set(n, (seen.get(n) || 0) + 1)
  const dups = [...seen.entries()].filter(([, c]) => c > 1).map(([n, c]) => ({ serial: n, count: c }))
  const min = nums[0]
  const max = nums[nums.length - 1]
  const gaps = []
  for (let i = EXPECTED.serialMin; i <= EXPECTED.serialMax; i++) {
    if (!seen.has(i)) gaps.push(i)
  }
  return {
    min,
    max,
    count: nums.length,
    gaps: gaps.slice(0, 40),
    gapCount: gaps.length,
    dups: dups.slice(0, 20),
    dupCount: dups.length,
  }
}

function issue(severity, code, message, count = 0, samples = []) {
  return { severity, code, message, count, samples }
}

export function validateExtract(voters = [], families = [], meta = {}) {
  const total = voters.length
  const male = voters.filter((v) => v.gender === 'Male').length
  const female = voters.filter((v) => v.gender === 'Female').length
  const unknownGender = total - male - female

  const missing = {
    name: voters.filter((v) => !v.name).length,
    nameTe: voters.filter((v) => !v.nameTe).length,
    epic: voters.filter((v) => !v.epic).length,
    age: voters.filter((v) => v.age == null).length,
    gender: unknownGender,
    house: voters.filter((v) => !v.house).length,
    relation: voters.filter((v) => !v.relationType || !v.relationName).length,
    ward: voters.filter((v) => v.ward == null && v.part == null).length,
    habitation: voters.filter((v) => !v.habitation && !v.habitationId).length,
    photo: voters.filter((v) => !v.photo).length,
  }

  const epicBad = voters.filter((v) => v.epic && !EPIC_RE.test(String(v.epic).toUpperCase()))
  const epicCounts = new Map()
  for (const v of voters) {
    if (!v.epic) continue
    const k = String(v.epic).toUpperCase()
    if (!epicCounts.has(k)) epicCounts.set(k, [])
    epicCounts.get(k).push(v)
  }
  const epicDups = [...epicCounts.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([epic, rows]) => ({
      epic,
      count: rows.length,
      serials: rows.map((r) => r.serial),
    }))

  const ageOutliers = voters.filter((v) => v.age != null && (v.age < 18 || v.age > 120))
  const serials = voters.map((v) => v.serial)
  const serialInfo = serialAnalysis(serials)

  // Ward rollup vs expected
  const wardMap = new Map()
  for (const v of voters) {
    const w = Number(v.ward ?? v.part)
    if (!wardMap.has(w)) wardMap.set(w, { ward: w, total: 0, male: 0, female: 0, missingAge: 0, missingEpic: 0 })
    const row = wardMap.get(w)
    row.total += 1
    if (v.gender === 'Male') row.male += 1
    if (v.gender === 'Female') row.female += 1
    if (v.age == null) row.missingAge += 1
    if (!v.epic) row.missingEpic += 1
  }
  const wardChecks = Object.entries(EXPECTED.wardElectors).map(([ward, expected]) => {
    const w = Number(ward)
    const row = wardMap.get(w) || { ward: w, total: 0, male: 0, female: 0, missingAge: 0, missingEpic: 0 }
    const delta = row.total - expected
    return {
      ...row,
      expected,
      delta,
      status: delta === 0 ? 'ok' : 'warn',
    }
  })

  // Habitation range checks
  const habChecks = EXPECTED.habitations.map((h) => {
    const inRange = voters.filter((v) => v.serial >= h.from && v.serial <= h.to)
    const tagged = voters.filter((v) => Number(v.habitationId) === h.id)
    const expectedCount = h.to - h.from + 1
    const wrongTag = tagged.filter((v) => v.serial < h.from || v.serial > h.to)
    const missingTag = inRange.filter((v) => Number(v.habitationId) !== h.id)
    return {
      id: h.id,
      name: h.name,
      from: h.from,
      to: h.to,
      expected: expectedCount,
      inRange: inRange.length,
      tagged: tagged.length,
      wrongTag: wrongTag.length,
      missingTag: missingTag.length,
      status:
        inRange.length === expectedCount && missingTag.length === 0 && wrongTag.length === 0
          ? 'ok'
          : 'warn',
    }
  })

  const fieldCoverage = [
    { field: 'Name (EN)', count: total - missing.name, pct: pct(total - missing.name, total) },
    { field: 'Name (TE)', count: total - missing.nameTe, pct: pct(total - missing.nameTe, total) },
    { field: 'Voter ID / EPIC', count: total - missing.epic, pct: pct(total - missing.epic, total) },
    { field: 'Age', count: total - missing.age, pct: pct(total - missing.age, total) },
    { field: 'Gender', count: total - missing.gender, pct: pct(total - missing.gender, total) },
    { field: 'House No', count: total - missing.house, pct: pct(total - missing.house, total) },
    { field: 'Relation', count: total - missing.relation, pct: pct(total - missing.relation, total) },
    { field: 'Ward', count: total - missing.ward, pct: pct(total - missing.ward, total) },
    { field: 'Village / habitation', count: total - missing.habitation, pct: pct(total - missing.habitation, total) },
    { field: 'Photo (PDF)', count: total - missing.photo, pct: pct(total - missing.photo, total) },
  ]

  const enriched = {
    phone: voters.filter((v) => v.phone).length,
    address: voters.filter((v) => v.currentAddress).length,
    status: voters.filter((v) => v.voterStatus).length,
    notes: voters.filter((v) => v.notes).length,
    photo: total - missing.photo,
    any: voters.filter((v) => v.phone || v.currentAddress || v.voterStatus || v.notes).length,
  }

  const fam = {
    households: families.length,
    multi: families.filter((f) => f.size >= 2).length,
    links: families.reduce((s, f) => s + (f.linkedCount || 0), 0),
    unlinked: families.reduce((s, f) => s + (f.unlinkedCount || 0), 0),
    covered: families.reduce((s, f) => s + f.size, 0),
  }

  const issues = []
  if (total !== EXPECTED.total) {
    issues.push(
      issue('error', 'total_mismatch', `Elector count ${total} ≠ expected ${EXPECTED.total}`, Math.abs(total - EXPECTED.total)),
    )
  }
  if (male !== EXPECTED.male) {
    issues.push(issue('warn', 'male_mismatch', `Male ${male} ≠ expected ${EXPECTED.male}`, Math.abs(male - EXPECTED.male)))
  }
  if (female !== EXPECTED.female) {
    issues.push(
      issue('warn', 'female_mismatch', `Female ${female} ≠ expected ${EXPECTED.female}`, Math.abs(female - EXPECTED.female)),
    )
  }
  if (serialInfo.gapCount) {
    issues.push(
      issue(
        'error',
        'serial_gaps',
        `${serialInfo.gapCount} missing serial(s) in ${EXPECTED.serialMin}–${EXPECTED.serialMax}`,
        serialInfo.gapCount,
        serialInfo.gaps.slice(0, 8).map(String),
      ),
    )
  }
  if (serialInfo.dupCount) {
    issues.push(
      issue(
        'error',
        'serial_dups',
        `${serialInfo.dupCount} duplicate serial number(s)`,
        serialInfo.dupCount,
        serialInfo.dups.slice(0, 5).map((d) => String(d.serial)),
      ),
    )
  }
  if (epicDups.length) {
    issues.push(
      issue(
        'error',
        'epic_dups',
        `${epicDups.length} duplicate voter ID(s)`,
        epicDups.length,
        epicDups.slice(0, 5).map((d) => d.epic),
      ),
    )
  }
  if (epicBad.length) {
    issues.push(
      issue(
        'warn',
        'epic_format',
        `${epicBad.length} voter ID(s) not matching AAA#######`,
        epicBad.length,
        epicBad.slice(0, 5).map((v) => v.epic),
      ),
    )
  }
  for (const [key, count] of Object.entries(missing)) {
    if (count > 0) {
      issues.push(
        issue(
          key === 'name' || key === 'epic' ? 'error' : 'warn',
          `missing_${key}`,
          key === 'photo'
            ? `${count} elector(s) without PDF photo mapping`
            : `Missing ${key.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${count}`,
          count,
          key === 'photo'
            ? voters
                .filter((v) => !v.photo)
                .slice(0, 5)
                .map((v) => v.epic || String(v.serial))
            : [],
        ),
      )
    }
  }
  if (ageOutliers.length) {
    issues.push(
      issue(
        'warn',
        'age_outliers',
        `${ageOutliers.length} age value(s) outside 18–120`,
        ageOutliers.length,
        ageOutliers.slice(0, 5).map((v) => `${v.serial}:${v.age}`),
      ),
    )
  }
  for (const w of wardChecks) {
    if (w.delta !== 0) {
      issues.push(
        issue('warn', `ward_${w.ward}`, `Ward ${w.ward}: ${w.total} electors (expected ${w.expected})`, Math.abs(w.delta)),
      )
    }
  }
  for (const h of habChecks) {
    if (h.status !== 'ok') {
      issues.push(
        issue(
          'warn',
          `hab_${h.id}`,
          `${h.name}: range ${h.inRange}/${h.expected}, mistagged ${h.missingTag + h.wrongTag}`,
          h.missingTag + h.wrongTag,
        ),
      )
    }
  }

  const errors = issues.filter((i) => i.severity === 'error').length
  const warnings = issues.filter((i) => i.severity === 'warn').length
  const scoreParts = [
    total === EXPECTED.total,
    male === EXPECTED.male,
    female === EXPECTED.female,
    serialInfo.gapCount === 0,
    serialInfo.dupCount === 0,
    epicDups.length === 0,
    missing.name === 0,
    missing.epic === 0,
    missing.gender === 0,
    missing.age === 0,
    wardChecks.every((w) => w.status === 'ok'),
    habChecks.every((h) => h.status === 'ok'),
  ]
  const score = Math.round((scoreParts.filter(Boolean).length / scoreParts.length) * 100)

  const overall =
    errors === 0 && warnings === 0 ? 'ok' : errors === 0 ? 'warn' : 'fail'

  return {
    overall,
    score,
    errors,
    warnings,
    expected: EXPECTED,
    totals: {
      total,
      male,
      female,
      unknownGender,
      expectedTotal: EXPECTED.total,
      expectedMale: EXPECTED.male,
      expectedFemale: EXPECTED.female,
      deltaTotal: total - EXPECTED.total,
      deltaMale: male - EXPECTED.male,
      deltaFemale: female - EXPECTED.female,
      metaTotal: meta.total ?? null,
    },
    missing,
    fieldCoverage,
    serialInfo,
    epicDups,
    epicBadCount: epicBad.length,
    ageOutliers: ageOutliers.slice(0, 30).map((v) => ({
      serial: v.serial,
      epic: v.epic,
      name: v.name,
      age: v.age,
    })),
    wardChecks,
    habChecks,
    enriched,
    fam,
    issues: issues.sort((a, b) => {
      const rank = { error: 0, warn: 1, info: 2 }
      return (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || b.count - a.count
    }),
    samples: {
      missingName: voters.filter((v) => !v.name).slice(0, 10),
      missingEpic: voters.filter((v) => !v.epic).slice(0, 10),
      missingGender: voters.filter((v) => !v.gender).slice(0, 10),
      missingHouse: voters.filter((v) => !v.house).slice(0, 10),
    },
  }
}
