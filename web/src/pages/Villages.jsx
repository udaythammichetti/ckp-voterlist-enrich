import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import TeText from '../components/TeText'
import { useVoterData } from '../context/VoterData'

export default function Villages() {
  const { loading, error, stats, campaign } = useVoterData()

  const campaignByVillage = useMemo(() => {
    const map = new Map()
    for (const v of campaign?.villages || []) {
      map.set(String(v.habitationId ?? v.habitation ?? v.key), v)
    }
    return map
  }, [campaign])

  if (loading) return <p className="state">Loading…</p>
  if (error) return <p className="state error">{error}</p>

  const villages = (stats.villages || stats.sections || [])
    .slice()
    .sort((a, b) => Number(a.habitationId || 0) - Number(b.habitationId || 0))

  return (
    <div className="stack">
      <div className="crumb">
        <Link to="/">{stats.panchayat || 'Home'}</Link>
        <span>/</span>
        <strong>Villages</strong>
      </div>
      <header className="page-head">
        <h1>Villages</h1>
        <p className="lede">{villages.length} habitations</p>
      </header>

      <div className="table-wrap">
        <table className="voter-table compact-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Village</th>
              <th>Ward</th>
              <th>Electors</th>
              <th>Support+</th>
              <th>Not support</th>
              <th>Not set</th>
            </tr>
          </thead>
          <tbody>
            {villages.map((v) => {
              const key = String(v.habitationId ?? v.habitation ?? v.key)
              const camp = campaignByVillage.get(key)
              return (
                <tr key={v.key}>
                  <td>{v.habitationId || '—'}</td>
                  <td>
                    <Link
                      className="cell-link"
                      to={`/villages/${encodeURIComponent(v.habitationId ?? v.habitation ?? v.key)}`}
                    >
                      <TeText value={v.habitation || v.label} teValue={v.habitationTe} />
                    </Link>
                  </td>
                  <td>{v.ward ?? v.part ?? '—'}</td>
                  <td>{v.total.toLocaleString()}</td>
                  <td>{camp?.positive ?? 0}</td>
                  <td>{camp?.negative ?? 0}</td>
                  <td>
                    <strong>{camp?.unset ?? '—'}</strong>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
