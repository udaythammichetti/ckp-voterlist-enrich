import { useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import FiltersBar from '../components/FiltersBar'
import TeText from '../components/TeText'
import VoterTable from '../components/VoterTable'
import { buildCampaignStatus } from '../lib/campaignStatus'
import { useVoterData } from '../context/VoterData'

export default function WardDetail() {
  const { wardId } = useParams()
  const { loading, error, voters, filtered, stats, setPart } = useVoterData()

  useEffect(() => {
    setPart(String(wardId))
    return () => setPart('')
  }, [wardId, setPart])

  const wardVoters = useMemo(
    () => voters.filter((v) => Number(v.ward ?? v.part) === Number(wardId)),
    [voters, wardId],
  )

  const villages = useMemo(() => {
    const map = new Map()
    for (const v of wardVoters) {
      const key = v.habitationId ?? v.habitation
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          name: v.habitation,
          nameTe: v.habitationTe,
          total: 0,
          male: 0,
          female: 0,
          houses: new Set(),
        })
      }
      const row = map.get(key)
      row.total += 1
      if (v.gender === 'Male') row.male += 1
      if (v.gender === 'Female') row.female += 1
      if (v.house) row.houses.add(v.house)
    }
    return [...map.values()]
      .map((r) => ({ ...r, households: r.houses.size }))
      .sort((a, b) => b.total - a.total)
  }, [wardVoters])

  const wardCampaign = useMemo(() => buildCampaignStatus(wardVoters), [wardVoters])

  if (loading) return <p className="state">Loading…</p>
  if (error) return <p className="state error">{error}</p>

  return (
    <div className="stack">
      <div className="crumb">
        <Link to="/">{stats.panchayat}</Link>
        <span>/</span>
        <Link to="/wards">Wards</Link>
        <span>/</span>
        <strong>Ward {wardId}</strong>
      </div>

      <header className="page-head">
        <h1>Ward {wardId}</h1>
        <p className="lede">
          {wardVoters.length.toLocaleString()} electors · {villages.length} villages
          {wardCampaign
            ? ` · ${wardCampaign.positive} support+ · ${wardCampaign.unset} not set`
            : ''}
        </p>
      </header>

      <div className="table-wrap">
        <table className="voter-table">
          <thead>
            <tr>
              <th>Village</th>
              <th>Electors</th>
              <th>M / F</th>
              <th>Houses</th>
            </tr>
          </thead>
          <tbody>
            {villages.map((v) => (
              <tr key={String(v.id)}>
                <td>
                  <Link className="cell-link" to={`/villages/${encodeURIComponent(v.id)}`}>
                    <TeText value={v.name} teValue={v.nameTe} />
                  </Link>
                </td>
                <td>{v.total}</td>
                <td>
                  {v.male} / {v.female}
                </td>
                <td>{v.households}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <FiltersBar showPart={false} showSection lockPart={wardId} />
      <VoterTable rows={filtered} pageSize={80} exportName={`ward_${wardId}_voters.csv`} showSection />
    </div>
  )
}
