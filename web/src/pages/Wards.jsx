import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useVoterData } from '../context/VoterData'

export default function Wards() {
  const { loading, error, stats, families, campaign } = useVoterData()

  const enrichment = useMemo(() => {
    const map = new Map()
    for (const f of families) {
      const ward = Number(f.part)
      if (!map.has(ward)) map.set(ward, { households: 0, links: 0, unlinked: 0 })
      const row = map.get(ward)
      row.households += 1
      row.links += f.linkedCount || 0
      row.unlinked += f.unlinkedCount || 0
    }
    return map
  }, [families])

  const campaignByWard = useMemo(() => {
    const map = new Map()
    for (const w of campaign?.wards || []) map.set(Number(w.ward), w)
    return map
  }, [campaign])

  if (loading) return <p className="state">Loading…</p>
  if (error) return <p className="state error">{error}</p>

  const wards = stats.wards || stats.parts || []

  return (
    <div className="stack">
      <div className="crumb">
        <Link to="/">{stats.panchayat || stats.constituency}</Link>
        <span>/</span>
        <strong>Wards</strong>
      </div>
      <header className="page-head">
        <h1>Wards</h1>
        <p className="lede">Electors and campaign status by ward.</p>
      </header>

      <div className="table-wrap">
        <table className="voter-table compact-table">
          <thead>
            <tr>
              <th>Ward</th>
              <th>Electors</th>
              <th>M / F</th>
              <th>Houses</th>
              <th>Support+</th>
              <th>Not support</th>
              <th>Not set</th>
              <th>Phone</th>
            </tr>
          </thead>
          <tbody>
            {wards.map((w) => {
              const id = w.ward ?? w.part
              const extra = enrichment.get(Number(id)) || { households: 0, links: 0, unlinked: 0 }
              const camp = campaignByWard.get(Number(id))
              return (
                <tr key={id}>
                  <td>
                    <Link className="cell-link" to={`/wards/${id}`}>
                      Ward {id}
                    </Link>
                  </td>
                  <td>{w.total.toLocaleString()}</td>
                  <td>
                    {w.male} / {w.female}
                  </td>
                  <td>{extra.households.toLocaleString()}</td>
                  <td>{camp?.positive ?? 0}</td>
                  <td>{camp?.negative ?? 0}</td>
                  <td>
                    <strong>{camp?.unset ?? '—'}</strong>
                  </td>
                  <td>{w.withPhone || 0}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
