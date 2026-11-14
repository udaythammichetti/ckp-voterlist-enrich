import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import FiltersBar from '../components/FiltersBar'
import VoterTable from '../components/VoterTable'
import { useVoterData } from '../context/VoterData'

export default function Voters() {
  const {
    loading,
    error,
    filtered,
    stats,
    filters,
    campaign,
    setSectionNo,
    setVoterStatus,
  } = useVoterData()

  useEffect(() => {
    setSectionNo('')
  }, [setSectionNo])

  if (loading) return <p className="state">Loading…</p>
  if (error) return <p className="state error">{error}</p>

  return (
    <div className="stack">
      <div className="crumb">
        <Link to="/">{stats.panchayat || 'Home'}</Link>
        <span>/</span>
        <strong>Voters</strong>
      </div>

      <header className="page-head voters-head">
        <div>
          <h1>Voters</h1>
          <p className="lede">Edit status, phone & address. Save version keeps the project latest.</p>
        </div>
        <div className="voters-chips">
          <span className="v-chip">
            <em>{filtered.length.toLocaleString()}</em> shown
          </span>
          {filters.part ? <span className="v-chip is-active">Ward {filters.part}</span> : null}
        </div>
      </header>

      <div className="campaign-chips" role="group" aria-label="Status">
        {[
          { label: 'All', value: '' },
          { label: 'Support+', value: 'support_plus', count: campaign?.positive },
          { label: 'Not support', value: 'not_support', count: campaign?.negative },
          { label: 'Pipeline', value: 'pipeline', count: campaign?.pipeline },
          { label: 'Field', value: 'field', count: campaign?.field },
          { label: 'Supporters', value: 'supporter', count: campaign?.supporter },
          { label: 'Not supporters', value: 'not_supporter', count: campaign?.not_supporter },
          { label: 'Undecided', value: 'undecided', count: campaign?.undecided },
          { label: 'Needs visit', value: 'needs_visit', count: campaign?.needs_visit },
          { label: 'Not set', value: 'unset', count: campaign?.unset },
        ].map((c) => (
          <button
            key={c.label}
            type="button"
            className={`campaign-chip ${filters.voterStatus === c.value ? 'is-active' : ''}`}
            onClick={() => setVoterStatus(c.value)}
          >
            {c.label}
            {c.count != null ? ` · ${c.count}` : ''}
          </button>
        ))}
      </div>

      <FiltersBar showSection />
      <VoterTable
        rows={filtered}
        pageSize={100}
        exportName="chukkavaripalli_voters.csv"
        showSection
        showVersionSave
      />
    </div>
  )
}
