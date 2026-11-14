/** Campaign status rollups from the active (latest) voter list. */

import { STATUS_GROUPS, VOTER_STATUSES, statusLabel, statusMeta } from './enrichment'

const STATUS_KEYS = VOTER_STATUSES.map((s) => s.value || 'unset')

function emptyBucket() {
  const bucket = {
    total: 0,
    withStatus: 0,
    withPhone: 0,
    withAddress: 0,
    withNotes: 0,
    positive: 0,
    softPositive: 0,
    negative: 0,
    risk: 0,
    pipeline: 0,
    field: 0,
    unset: 0,
  }
  for (const key of STATUS_KEYS) {
    if (key !== 'unset') bucket[key] = 0
  }
  return bucket
}

function bump(bucket, v) {
  bucket.total += 1
  if (v.phone) bucket.withPhone += 1
  if (v.currentAddress) bucket.withAddress += 1
  if (v.notes) bucket.withNotes += 1

  const key = v.voterStatus || 'unset'
  const group = statusMeta(key === 'unset' ? '' : key).group || 'unset'

  if (key === 'unset') {
    bucket.unset += 1
  } else {
    bucket.withStatus += 1
    if (bucket[key] != null) bucket[key] += 1
    else bucket[key] = 1
  }

  if (group === 'positive') bucket.positive += 1
  else if (group === 'soft_positive') {
    bucket.softPositive += 1
    bucket.positive += 1 // support+ includes leaning/pledged/family
  } else if (group === 'negative') bucket.negative += 1
  else if (group === 'pipeline') bucket.pipeline += 1
  else if (group === 'field') {
    bucket.field += 1
    bucket.risk += 1
  }

  // Opposed / not supporter also count toward risk pressure
  if (group === 'negative') bucket.risk += 1
}

function pct(n, total) {
  return total ? Math.round((n / total) * 1000) / 10 : 0
}

function finalize(bucket) {
  return {
    ...bucket,
    statusPct: pct(bucket.withStatus, bucket.total),
    positivePct: pct(bucket.positive, bucket.total),
    softPositivePct: pct(bucket.softPositive, bucket.total),
    negativePct: pct(bucket.negative, bucket.total),
    riskPct: pct(bucket.risk, bucket.total),
    pipelinePct: pct(bucket.pipeline, bucket.total),
    fieldPct: pct(bucket.field, bucket.total),
    phonePct: pct(bucket.withPhone, bucket.total),
    notesPct: pct(bucket.withNotes, bucket.total),
  }
}

const STATUS_ORDER = [
  'supporter',
  'family_support',
  'pledged',
  'contacted',
  'undecided',
  'not_contacted',
  'not_supporter',
  'opposed',
  'rival',
  'needs_visit',
  'nr',
  'out_of_station',
  'shifted',
  'unset',
]

/**
 * Full campaign projection from current in-memory voters (latest loaded list).
 */
export function buildCampaignStatus(voters = []) {
  const overall = emptyBucket()
  const wardMap = new Map()
  const villageMap = new Map()

  for (const v of voters) {
    bump(overall, v)

    const wardId = v.ward ?? v.part ?? '—'
    const wardKey = String(wardId)
    if (!wardMap.has(wardKey)) {
      wardMap.set(wardKey, { ...emptyBucket(), ward: wardId, label: `Ward ${wardId}` })
    }
    bump(wardMap.get(wardKey), v)

    const villageKey = String(v.habitationId ?? v.habitation ?? 'unknown')
    if (!villageMap.has(villageKey)) {
      villageMap.set(villageKey, {
        ...emptyBucket(),
        habitationId: v.habitationId,
        habitation: v.habitation || 'Unmapped',
        habitationTe: v.habitationTe || '',
        label: v.habitation || 'Unmapped',
        key: villageKey,
      })
    }
    bump(villageMap.get(villageKey), v)
  }

  const counts = {}
  for (const key of STATUS_ORDER) counts[key] = overall[key] || 0

  const maxCount = Math.max(1, ...Object.values(counts))
  const bars = STATUS_ORDER.filter((key) => counts[key] > 0).map((key) => {
    const meta = statusMeta(key === 'unset' ? '' : key)
    return {
      value: key,
      band: key === 'unset' ? 'Not set' : statusLabel(key),
      group: meta.group || 'unset',
      groupLabel: STATUS_GROUPS[meta.group] || meta.group,
      count: counts[key],
      pct: pct(counts[key], overall.total),
      bar: Math.round((counts[key] / maxCount) * 100),
    }
  })

  const groupBars = Object.entries(STATUS_GROUPS)
    .map(([group, label]) => {
      let count = 0
      if (group === 'positive') count = overall.supporter || 0
      else if (group === 'soft_positive') count = overall.softPositive || 0
      else if (group === 'negative') count = overall.negative || 0
      else if (group === 'pipeline') count = overall.pipeline || 0
      else if (group === 'field') count = overall.field || 0
      else if (group === 'unset') count = overall.unset || 0
      return {
        value: group,
        band: label,
        count,
        pct: pct(count, overall.total),
        bar: 0,
      }
    })
    .filter((g) => g.count > 0)

  const groupMax = Math.max(1, ...groupBars.map((g) => g.count))
  for (const g of groupBars) g.bar = Math.round((g.count / groupMax) * 100)

  const wards = [...wardMap.values()]
    .map(finalize)
    .sort((a, b) => Number(a.ward) - Number(b.ward))

  const villages = [...villageMap.values()]
    .map(finalize)
    .sort((a, b) => b.total - a.total)

  const done = finalize(overall)

  return {
    ...done,
    counts,
    bars,
    groupBars,
    wards,
    villages,
    statusLabels: VOTER_STATUSES,
    summary: {
      contactedShare: pct(done.withStatus, done.total),
      supportShare: pct(done.positive, done.total),
      notSupportShare: pct(done.negative, done.total),
      riskShare: pct(done.risk, done.total),
      openShare: pct(done.unset + done.pipeline, done.total),
      fieldShare: pct(done.field, done.total),
    },
  }
}

export function campaignTone(bucket) {
  if (!bucket?.total) return 'neutral'
  if ((bucket.negativePct || 0) >= 12 || (bucket.riskPct || 0) >= 18) return 'risk'
  if ((bucket.positivePct || 0) >= 20) return 'strong'
  if ((bucket.statusPct || 0) >= 40) return 'active'
  return 'neutral'
}
