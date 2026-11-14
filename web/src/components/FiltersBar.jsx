import { useMemo } from 'react'
import { VOTER_STATUSES } from '../lib/enrichment'
import { useVoterData } from '../context/VoterData'

export default function FiltersBar({ showPart = true, showSection = true, lockPart = null }) {
  const {
    stats,
    voters,
    filters,
    setQ,
    setPart,
    setSectionNo,
    setGender,
    setAgeBand,
    setEnrichedOnly,
    setVoterStatus,
    clearFilters,
  } = useVoterData()

  const sectionOptions = useMemo(() => {
    const partFilter = lockPart ?? filters.part
    const map = new Map()
    for (const v of voters) {
      if (partFilter !== '' && partFilter != null && Number(v.part) !== Number(partFilter)) continue
      const key = v.habitationId != null ? String(v.habitationId) : v.habitation
      if (!key) continue
      if (!map.has(key)) {
        map.set(key, v.habitation || key)
      }
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }))
  }, [voters, filters.part, lockPart])

  return (
    <div className="filters no-print">
      <label className="filter-field grow">
        <span>Search</span>
        <input
          value={filters.q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="S.No, name, voter ID, house, village, phone…"
        />
      </label>
      {showPart ? (
        <label className="filter-field">
          <span>Ward</span>
          <select
            value={filters.part}
            onChange={(e) => {
              setPart(e.target.value)
              setSectionNo('')
            }}
          >
            <option value="">All wards</option>
            {(stats.wards || stats.parts || []).map((p) => (
              <option key={p.ward ?? p.part} value={p.ward ?? p.part}>
                Ward {p.ward ?? p.part}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {showSection ? (
        <label className="filter-field" style={{ minWidth: 220 }}>
          <span>Village</span>
          <select value={filters.sectionNo} onChange={(e) => setSectionNo(e.target.value)}>
            <option value="">All villages</option>
            {sectionOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="filter-field">
        <span>Gender</span>
        <select value={filters.gender} onChange={(e) => setGender(e.target.value)}>
          <option value="">All</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
        </select>
      </label>
      <label className="filter-field">
        <span>Age band</span>
        <select value={filters.ageBand} onChange={(e) => setAgeBand(e.target.value)}>
          <option value="">All</option>
          {stats.ageBands.map((b) => (
            <option key={b.band} value={b.band}>
              {b.band}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-field">
        <span>Status</span>
        <select value={filters.voterStatus || ''} onChange={(e) => setVoterStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="support_plus">Support+ (all)</option>
          <option value="not_support">Not support (all)</option>
          <option value="pipeline">Pipeline (all)</option>
          <option value="field">Field (all)</option>
          <option value="unset">Not set</option>
          {VOTER_STATUSES.filter((s) => s.value).map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-field">
        <span>Enrichment</span>
        <select
          value={filters.enrichedOnly ? 'yes' : ''}
          onChange={(e) => setEnrichedOnly(e.target.value === 'yes')}
        >
          <option value="">All</option>
          <option value="yes">Any field filled</option>
        </select>
      </label>
      <button type="button" className="ghost-btn" onClick={clearFilters}>
        Reset
      </button>
    </div>
  )
}
