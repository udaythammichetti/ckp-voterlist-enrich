import { Link, useNavigate } from 'react-router-dom'
import CampaignStatusPanel from '../components/CampaignStatusPanel'
import TeText from '../components/TeText'
import { useVoterData } from '../context/VoterData'

export default function Campaign() {
  const { loading, error, campaign, stats, dataSource, setVoterStatus, setPart } = useVoterData()
  const navigate = useNavigate()

  if (loading) return <p className="state">Loading…</p>
  if (error) return <p className="state error">{error}</p>
  if (!campaign) return <p className="state">No data.</p>

  const go = (status) => {
    setVoterStatus(status)
    navigate('/voters')
  }

  return (
    <div className="stack">
      <div className="crumb">
        <Link to="/">{stats.panchayat || 'Home'}</Link>
        <span>/</span>
        <strong>Campaign</strong>
      </div>

      <header className="page-head">
        <div>
          <h1>Campaign</h1>
          <p className="lede">
            {campaign.withStatus.toLocaleString()} status set · {campaign.statusPct}% coverage
            {dataSource ? (
              <>
                {' '}
                · <code className="inline-code">{dataSource}</code>
              </>
            ) : null}
          </p>
        </div>
      </header>

      <div className="campaign-chips" role="group">
        {[
          { label: 'All', value: '' },
          { label: 'Supporters', value: 'supporter' },
          { label: 'Not supporters', value: 'not_supporter' },
          { label: 'Undecided', value: 'undecided' },
          { label: 'Needs visit', value: 'needs_visit' },
          { label: 'Not set', value: 'unset' },
        ].map((c) => (
          <button key={c.label} type="button" className="campaign-chip" onClick={() => go(c.value)}>
            {c.label}
            {c.value === 'supporter' ? ` · ${campaign.supporter || 0}` : ''}
            {c.value === 'not_supporter' ? ` · ${campaign.not_supporter || 0}` : ''}
            {c.value === 'undecided' ? ` · ${campaign.undecided || 0}` : ''}
            {c.value === 'needs_visit' ? ` · ${campaign.needs_visit || 0}` : ''}
            {c.value === 'unset' ? ` · ${campaign.unset || 0}` : ''}
          </button>
        ))}
      </div>

      <CampaignStatusPanel campaign={campaign} dataSource={dataSource} title="Overview" />

      <section className="split">
        <article className="panel">
          <div className="panel-head">
            <h2>By status</h2>
          </div>
          <div className="table-wrap flat">
            <table className="voter-table compact-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Count</th>
                  <th>%</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {campaign.bars.map((row) => (
                  <tr key={row.value}>
                    <td>
                      <span
                        className={`status-pill status-${row.value === 'unset' ? 'not_contacted' : row.value}`}
                      >
                        {row.band}
                      </span>
                    </td>
                    <td>{row.count.toLocaleString()}</td>
                    <td>{row.pct}%</td>
                    <td>
                      <button
                        type="button"
                        className="ghost-btn toolbar-btn"
                        onClick={() => go(row.value === 'unset' ? 'unset' : row.value)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <h2>Wards</h2>
            <Link to="/wards">All</Link>
          </div>
          <div className="table-wrap flat">
            <table className="voter-table compact-table">
              <thead>
                <tr>
                  <th>Ward</th>
                  <th>Support+</th>
                  <th>Not support</th>
                  <th>Not set</th>
                </tr>
              </thead>
              <tbody>
                {campaign.wards.map((w) => (
                  <tr key={w.ward}>
                    <td>
                      <Link
                        className="cell-link"
                        to={`/wards/${w.ward}`}
                        onClick={() => setPart(String(w.ward))}
                      >
                        {w.label}
                      </Link>
                    </td>
                    <td>{w.positive}</td>
                    <td>{w.negative || 0}</td>
                    <td>
                      <strong>{w.unset}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <article className="panel">
        <div className="panel-head">
          <h2>Villages</h2>
          <Link to="/villages">All</Link>
        </div>
        <div className="table-wrap flat">
          <table className="voter-table compact-table">
            <thead>
              <tr>
                <th>Village</th>
                <th>Electors</th>
                <th>Support+</th>
                <th>Not support</th>
                <th>Not set</th>
              </tr>
            </thead>
            <tbody>
              {campaign.villages.map((v) => (
                <tr key={v.key}>
                  <td>
                    <Link
                      className="cell-link"
                      to={`/villages/${encodeURIComponent(v.habitationId ?? v.habitation ?? v.key)}`}
                    >
                      <TeText value={v.habitation} teValue={v.habitationTe} />
                    </Link>
                  </td>
                  <td>{v.total}</td>
                  <td>{v.positive}</td>
                  <td>{v.negative || 0}</td>
                  <td>{v.unset}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  )
}
