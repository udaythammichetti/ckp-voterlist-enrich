import { Link, useNavigate } from 'react-router-dom'
import MixBars from '../components/MixBars'
import TeText from '../components/TeText'
import { useLocale } from '../context/Locale'
import { useVoterData } from '../context/VoterData'

function CoverMeter({ pct = 0 }) {
  const value = Math.max(0, Math.min(100, Number(pct) || 0))
  const tone = value >= 60 ? 'good' : value >= 25 ? 'mid' : 'low'
  return (
    <div className={`cover-meter tone-${tone}`} title={`${value}% status set`}>
      <div className="cover-meter-track">
        <span style={{ width: `${value}%` }} />
      </div>
      <em>{value}%</em>
    </div>
  )
}

export default function Dashboard() {
  const {
    loading,
    error,
    stats,
    famStats,
    voters,
    campaign,
    setVoterStatus,
    setPart,
  } = useVoterData()
  const { isTe } = useLocale()
  const navigate = useNavigate()

  if (loading) return <p className="state">Loading…</p>
  if (error) return <p className="state error">{error}</p>

  const goStatus = (status, ward = '') => {
    setPart(ward ? String(ward) : '')
    setVoterStatus(status)
    navigate('/voters')
  }

  const topWards = (campaign?.wards || [])
    .slice()
    .sort((a, b) => b.unset - a.unset || b.total - a.total)
    .slice(0, 6)

  const villageCampaign = (campaign?.villages || [])
    .slice()
    .sort((a, b) => b.unset - a.unset || b.total - a.total)
    .slice(0, 10)

  return (
    <div className="stack dash-home">
      <section className="hero-panel hero-election hero-campaign">
        <div className="hero-copy">
          <p className="eyebrow">
            Sarpanch · Chukkavaripalli
            {isTe ? <span className="lang-hint"> · 2026</span> : null}
          </p>
          <h1>Campaign desk</h1>
          <p className="lede">
            {stats.total.toLocaleString()} electors · {stats.wardsCount || stats.partsCount} wards ·{' '}
            {famStats.households.toLocaleString()} houses
          </p>
          <div className="hero-actions">
            <Link className="secondary-btn" to="/voters">
              Open voters
            </Link>
            <Link className="ghost-btn" to="/campaign">
              Full campaign
            </Link>
          </div>
        </div>
        <div className="hero-stats hero-stats-6">
          <button type="button" className="hs-pos hs-link" onClick={() => goStatus('support_plus')}>
            <span>Support+</span>
            <strong>{campaign?.positive || 0}</strong>
          </button>
          <button type="button" className="hs-neg hs-link" onClick={() => goStatus('not_support')}>
            <span>Not support</span>
            <strong>{campaign?.negative || 0}</strong>
          </button>
          <button type="button" className="hs-pipe hs-link" onClick={() => goStatus('undecided')}>
            <span>Undecided</span>
            <strong>{campaign?.undecided || 0}</strong>
          </button>
          <button type="button" className="hs-field hs-link" onClick={() => goStatus('needs_visit')}>
            <span>Needs visit</span>
            <strong>{campaign?.needs_visit || 0}</strong>
          </button>
          <button type="button" className="hs-unset hs-link" onClick={() => goStatus('unset')}>
            <span>Not set</span>
            <strong>{campaign?.unset || 0}</strong>
          </button>
          <Link className="hs-cover hs-link" to="/campaign">
            <span>Coverage</span>
            <strong>{campaign?.statusPct || 0}%</strong>
          </Link>
        </div>
      </section>

      <section className="quick-actions quick-actions-6" aria-label="Status shortcuts">
        <button type="button" className="quick-card qc-positive" onClick={() => goStatus('supporter')}>
          <span>Supporters</span>
          <strong>{(campaign?.supporter || 0).toLocaleString()}</strong>
        </button>
        <button type="button" className="quick-card qc-teal" onClick={() => goStatus('family_support')}>
          <span>Family support</span>
          <strong>{(campaign?.family_support || 0).toLocaleString()}</strong>
        </button>
        <button type="button" className="quick-card qc-negative" onClick={() => goStatus('not_supporter')}>
          <span>Not supporters</span>
          <strong>{(campaign?.not_supporter || 0).toLocaleString()}</strong>
        </button>
        <button type="button" className="quick-card qc-negative" onClick={() => goStatus('opposed')}>
          <span>Opposed</span>
          <strong>{(campaign?.opposed || 0).toLocaleString()}</strong>
        </button>
        <button type="button" className="quick-card qc-warn" onClick={() => goStatus('needs_visit')}>
          <span>Needs visit</span>
          <strong>{(campaign?.needs_visit || 0).toLocaleString()}</strong>
        </button>
        <button type="button" className="quick-card qc-muted" onClick={() => goStatus('unset')}>
          <span>Not set</span>
          <strong>{(campaign?.unset || 0).toLocaleString()}</strong>
        </button>
      </section>

      <section className="split">
        <article className="panel">
          <div className="panel-head">
            <h2>Status mix</h2>
            <Link to="/campaign">{campaign?.statusPct || 0}% set</Link>
          </div>
          {campaign?.groupBars?.length ? (
            <MixBars items={campaign.groupBars} accent="amber" />
          ) : (
            <p className="muted small">Set status on voters to see the mix.</p>
          )}
        </article>

        <article className="panel">
          <div className="panel-head">
            <h2>Wards to cover</h2>
            <Link to="/wards">All wards</Link>
          </div>
          <div className="table-wrap flat">
            <table className="voter-table compact-table report-table">
              <thead>
                <tr>
                  <th>Ward</th>
                  <th className="num">Support+</th>
                  <th className="num">Not support</th>
                  <th className="num">Not set</th>
                </tr>
              </thead>
              <tbody>
                {topWards.map((w) => (
                  <tr key={w.ward}>
                    <td>
                      <Link className="cell-link" to={`/wards/${w.ward}`}>
                        {w.label}
                      </Link>
                    </td>
                    <td className="num num-pos">
                      <button
                        type="button"
                        className="cell-btn num-pos"
                        onClick={() => goStatus('support_plus', w.ward)}
                      >
                        {w.positive}
                      </button>
                    </td>
                    <td className="num num-neg">
                      <button
                        type="button"
                        className="cell-btn num-neg"
                        onClick={() => goStatus('not_support', w.ward)}
                      >
                        {w.negative || 0}
                      </button>
                    </td>
                    <td className="num num-unset">
                      <button
                        type="button"
                        className="cell-btn"
                        onClick={() => goStatus('unset', w.ward)}
                      >
                        <strong>{w.unset}</strong>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <article className="panel campaign-report-panel">
        <div className="panel-head">
          <div>
            <h2>Villages needing coverage</h2>
            <p className="panel-sub muted small">Top by unset · tap Support+ / Not support to open voters</p>
          </div>
          <Link to="/campaign">Full report</Link>
        </div>
        <div className="table-wrap flat report-scroll">
          <table className="voter-table compact-table report-table village-campaign-table">
            <thead>
              <tr>
                <th>Village</th>
                <th className="num">Electors</th>
                <th className="num">Support+</th>
                <th className="num">Not support</th>
                <th className="num">Not set</th>
                <th>Coverage</th>
              </tr>
            </thead>
            <tbody>
              {villageCampaign.map((v) => (
                <tr key={v.key}>
                  <td className="sticky-col">
                    <Link
                      className="cell-link"
                      to={`/villages/${encodeURIComponent(v.habitationId ?? v.habitation ?? v.key)}`}
                    >
                      <TeText value={v.habitation || v.label} teValue={v.habitationTe} />
                    </Link>
                  </td>
                  <td className="num">{v.total}</td>
                  <td className="num num-pos">
                    <button
                      type="button"
                      className="cell-btn num-pos"
                      onClick={() => goStatus('support_plus')}
                    >
                      {v.positive || 0}
                    </button>
                  </td>
                  <td className="num num-neg">
                    <button
                      type="button"
                      className="cell-btn num-neg"
                      onClick={() => goStatus('not_support')}
                    >
                      {v.negative || 0}
                    </button>
                  </td>
                  <td className="num num-unset">
                    <strong>{v.unset || 0}</strong>
                  </td>
                  <td>
                    <CoverMeter pct={v.statusPct} />
                  </td>
                </tr>
              ))}
              {!villageCampaign.length ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No village campaign data yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </article>

      <article className="panel">
        <div className="panel-head">
          <h2>Largest houses</h2>
          <Link to="/families">Families</Link>
        </div>
        <div className="table-wrap flat">
          <table className="voter-table compact-table">
            <thead>
              <tr>
                <th>Ward</th>
                <th>House</th>
                <th>Head</th>
                <th className="num">Size</th>
              </tr>
            </thead>
            <tbody>
              {famStats.topFamilies.slice(0, 6).map((f) => (
                <tr key={f.id}>
                  <td>{f.part}</td>
                  <td>
                    <Link className="cell-link" to={`/families/${encodeURIComponent(f.id)}`}>
                      {f.house}
                    </Link>
                  </td>
                  <td>
                    <TeText
                      value={f.headName}
                      teValue={voters.find((x) => x.epic === f.headEpic)?.nameTe}
                    />
                  </td>
                  <td className="num">{f.size}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  )
}
