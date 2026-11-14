import { useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import FiltersBar from '../components/FiltersBar'
import TeText from '../components/TeText'
import VoterTable from '../components/VoterTable'
import { buildCampaignStatus } from '../lib/campaignStatus'
import { useVoterData } from '../context/VoterData'

export default function VillageDetail() {
  const { villageId } = useParams()
  const decoded = decodeURIComponent(villageId || '')
  const { loading, error, voters, families, stats, setSectionNo, filtered } = useVoterData()

  const villageVoters = useMemo(
    () =>
      voters.filter(
        (v) =>
          String(v.habitationId) === decoded ||
          v.habitation === decoded ||
          v.section === decoded ||
          v.sectionKey === decoded,
      ),
    [voters, decoded],
  )

  useEffect(() => {
    // Prefer numeric habitation id for filter
    const sample = villageVoters[0]
    if (sample?.habitationId != null) setSectionNo(String(sample.habitationId))
    else if (sample?.habitation) setSectionNo(sample.habitation)
    return () => setSectionNo('')
  }, [decoded, villageVoters, setSectionNo])

  const sample = villageVoters[0]
  const villageFamilies = useMemo(() => {
    const epics = new Set(villageVoters.map((v) => v.epic))
    return families
      .filter((f) => f.members.some((m) => epics.has(m.epic)))
      .sort((a, b) => b.size - a.size)
  }, [families, villageVoters])

  const villageCampaign = useMemo(() => buildCampaignStatus(villageVoters), [villageVoters])

  if (loading) return <p className="state">Loading…</p>
  if (error) return <p className="state error">{error}</p>
  if (!villageVoters.length) return <p className="state">Village not found.</p>

  return (
    <div className="stack">
      <div className="crumb">
        <Link to="/">{stats.panchayat}</Link>
        <span>/</span>
        <Link to="/villages">Villages</Link>
        <span>/</span>
        <strong>
          <TeText value={sample.habitation} teValue={sample.habitationTe} />
        </strong>
      </div>

      <header className="page-head">
        <h1>
          <TeText value={sample.habitation} teValue={sample.habitationTe} />
        </h1>
        <p className="lede">
          Ward {sample.ward ?? sample.part} · {villageVoters.length.toLocaleString()} electors ·{' '}
          {villageFamilies.length} houses · {villageCampaign.positive} support+ ·{' '}
          {villageCampaign.unset} not set
        </p>
      </header>

      <section className="panel">
        <div className="panel-head">
          <h2>Families</h2>
          <Link to="/families">All</Link>
        </div>
        <div className="table-wrap flat">
          <table className="voter-table">
            <thead>
              <tr>
                <th>House</th>
                <th>Head</th>
                <th>Size</th>
                <th>Links</th>
              </tr>
            </thead>
            <tbody>
              {villageFamilies.slice(0, 15).map((f) => (
                <tr key={f.id}>
                  <td>
                    <Link className="cell-link" to={`/families/${encodeURIComponent(f.id)}`}>
                      {f.house}
                    </Link>
                  </td>
                  <td>
                    <TeText value={f.headName} />
                  </td>
                  <td>{f.size}</td>
                  <td>{f.linkedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <FiltersBar showPart showSection={false} />
      <VoterTable
        rows={filtered.length ? filtered : villageVoters}
        pageSize={80}
        exportName={`village_${decoded}_voters.csv`}
        showSection={false}
      />
    </div>
  )
}
