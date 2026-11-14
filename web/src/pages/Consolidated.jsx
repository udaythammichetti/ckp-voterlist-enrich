import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import KpiGrid from '../components/KpiGrid'
import MixBars from '../components/MixBars'
import PartElectorsChart from '../components/PartElectorsChart'
import { buildConsolidated } from '../lib/consolidated'
import { normalizeBoothName } from '../lib/booths'
import { validateExtract } from '../lib/validateExtract'
import { useVoterData } from '../context/VoterData'

function deltaClass(d) {
  if (d == null) return 'muted'
  if (d === 0) return 'ok-pill'
  if (d < 0) return 'warn-pill'
  return 'bad-pill'
}

function fmtDelta(d) {
  if (d == null) return '—'
  if (d === 0) return '0'
  return d > 0 ? `+${d}` : String(d)
}

function StatusPill({ status }) {
  const label = status === 'ok' ? 'OK' : status === 'warn' ? 'WARN' : status === 'fail' ? 'FAIL' : status
  const cls = status === 'ok' ? 'ok-pill' : status === 'warn' ? 'warn-pill' : 'bad-pill'
  return <span className={cls}>{label}</span>
}

export default function Consolidated() {
  const { loading, error, voters, families, stats, famStats, meta, openVoter } = useVoterData()
  const navigate = useNavigate()

  const data = useMemo(() => {
    if (!voters.length) return null
    return buildConsolidated(voters, families, stats, famStats)
  }, [voters, families, stats, famStats])

  const report = useMemo(
    () => (voters.length ? validateExtract(voters, families, meta) : null),
    [voters, families, meta],
  )

  if (loading) return <p className="state">Loading…</p>
  if (error) return <p className="state error">{error}</p>
  if (!data || !report) return <p className="state">No voter data loaded.</p>

  const { totals, parts, stations, linkRate, genderMix, checks, missingSummary, crossCheck } = data

  const kpis = [
    {
      label: 'Validation score',
      value: `${report.score}%`,
      hint:
        report.overall === 'ok'
          ? 'All core checks passed'
          : `${report.errors} errors · ${report.warnings} warnings`,
    },
    {
      label: 'Electors',
      value: totals.electors.toLocaleString(),
      hint: `Cover net ${crossCheck.netSum.toLocaleString()} · Δ ${fmtDelta(crossCheck.totalDelta)}`,
      onClick: () => navigate('/voters'),
    },
    {
      label: 'Cross-check',
      value: `${crossCheck.okCount}/${crossCheck.checkCount}`,
      hint:
        crossCheck.issues === 0 ? 'All parts clean' : `${crossCheck.issues} part(s) need review`,
    },
    {
      label: 'Households',
      value: totals.households.toLocaleString(),
      hint: `Link ${linkRate}% · ${totals.unlinked.toLocaleString()} unlinked`,
      onClick: () => navigate('/families'),
    },
  ]

  return (
    <div className="stack">
      <div className="crumb">
        <Link to="/">{stats.constituency || stats.panchayat || 'Home'}</Link>
        <span>/</span>
        <strong>Consolidated</strong>
      </div>

      <header className="page-head consol-head">
        <div>
          <p className="eyebrow">Rollup + extract checks · {stats.yearOfRevision}</p>
          <h1>Consolidated</h1>
          <p className="lede">
            AC {stats.constituency} · PC {stats.parliamentaryConstituency} · {stats.district} ·{' '}
            {stats.tehsilMandal} · PIN {stats.pinCode}
          </p>
        </div>
        <div className="consol-actions">
          <span className="v-chip">
            Overall <em style={{ marginLeft: 6 }}>
              <StatusPill status={report.overall} />
            </em>
          </span>
          <Link className="secondary-btn" to="/voters">
            Voters
          </Link>
          <Link className="secondary-btn" to="/wards">
            Wards
          </Link>
          <Link className="secondary-btn" to="/families">
            Families
          </Link>
        </div>
      </header>

      <KpiGrid items={kpis} />

      <section className="panel">
        <div className="panel-head">
          <h2>Cross-checks</h2>
          <span className="muted">Extracted vs cover net · S.No · EPIC · missing fields</span>
        </div>
        <div className="check-grid">
          {checks.map((c) => (
            <article key={c.id} className={`check-card is-${c.severity}`}>
              <div className="check-top">
                <strong>{c.label}</strong>
                <span className={c.ok ? 'ok-pill' : c.severity === 'warn' ? 'warn-pill' : 'bad-pill'}>
                  {c.value}
                </span>
              </div>
              <p className="muted small tight">{c.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="split">
        <article className="panel">
          <div className="panel-head">
            <h2>Cover totals</h2>
            <StatusPill
              status={
                report.totals.deltaTotal === 0 &&
                report.totals.deltaMale === 0 &&
                report.totals.deltaFemale === 0
                  ? 'ok'
                  : 'warn'
              }
            />
          </div>
          <div className="table-wrap flat">
            <table className="voter-table compact-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th className="num">Extracted</th>
                  <th className="num">Expected</th>
                  <th>Δ</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Total', report.totals.total, report.totals.expectedTotal, report.totals.deltaTotal],
                  ['Male', report.totals.male, report.totals.expectedMale, report.totals.deltaMale],
                  [
                    'Female',
                    report.totals.female,
                    report.totals.expectedFemale,
                    report.totals.deltaFemale,
                  ],
                ].map(([label, got, exp, delta]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td className="num">{got.toLocaleString()}</td>
                    <td className="num">{exp.toLocaleString()}</td>
                    <td>
                      <span className={delta === 0 ? 'ok-pill' : 'warn-pill'}>
                        {delta === 0 ? '0' : delta > 0 ? `+${delta}` : delta}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <h2>Issue log</h2>
            <span className="muted">{report.issues.length} items</span>
          </div>
          {report.issues.length === 0 ? (
            <p className="muted small">No issues — extract looks clean.</p>
          ) : (
            <ul className="issue-list">
              {report.issues.map((i) => (
                <li key={i.code} className={`issue-item issue-${i.severity}`}>
                  <StatusPill status={i.severity === 'error' ? 'fail' : 'warn'} />
                  <div>
                    <strong>{i.message}</strong>
                    {i.samples?.length ? (
                      <div className="muted small mono">{i.samples.join(', ')}</div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      {(missingSummary.length > 0 || crossCheck.totalDelta !== 0) && (
        <section className="panel">
          <div className="panel-head">
            <h2>Missing / shortfall notes</h2>
            <span className="muted">What still needs attention</span>
          </div>
          <ul className="miss-list">
            {crossCheck.totalDelta !== 0 ? (
              <li>
                <strong>{Math.abs(crossCheck.totalDelta)}</strong> electors short of cover page net total
                across {crossCheck.partsWithDelta} parts.
              </li>
            ) : null}
            {crossCheck.totalSerialGaps > 0 ? (
              <li>
                <strong>{crossCheck.totalSerialGaps}</strong> S.No gaps inside part ranges.
              </li>
            ) : null}
            {missingSummary.map((f) => (
              <li key={f.field}>
                <strong>{f.field}</strong> coverage {f.pct}% · {(stats.total - f.count).toLocaleString()}{' '}
                missing
              </li>
            ))}
            {crossCheck.totalMissingRelation > 0 ? (
              <li>
                <strong>{crossCheck.totalMissingRelation}</strong> rows missing relation type/name.
              </li>
            ) : null}
          </ul>
        </section>
      )}

      <section className="split">
        <article className="panel">
          <div className="panel-head">
            <h2>Ward count vs PDF</h2>
            <Link to="/wards">Wards</Link>
          </div>
          <div className="table-wrap flat">
            <table className="voter-table compact-table">
              <thead>
                <tr>
                  <th>Ward</th>
                  <th className="num">Got</th>
                  <th className="num">Expected</th>
                  <th>Δ</th>
                  <th>M / F</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {report.wardChecks.map((w) => (
                  <tr key={w.ward}>
                    <td>
                      <Link className="cell-link" to={`/wards/${w.ward}`}>
                        Ward {w.ward}
                      </Link>
                    </td>
                    <td className="num">{w.total}</td>
                    <td className="num">{w.expected}</td>
                    <td>{w.delta === 0 ? '0' : w.delta > 0 ? `+${w.delta}` : w.delta}</td>
                    <td>
                      {w.male} / {w.female}
                    </td>
                    <td>
                      <StatusPill status={w.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <h2>Habitation mapping</h2>
            <Link to="/villages">Villages</Link>
          </div>
          <div className="table-wrap flat">
            <table className="voter-table compact-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Village</th>
                  <th>Range</th>
                  <th>In range</th>
                  <th>Mistag</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {report.habChecks.map((h) => (
                  <tr key={h.id}>
                    <td>{h.id}</td>
                    <td>
                      <Link className="cell-link" to={`/villages/${h.id}`}>
                        {h.name}
                      </Link>
                    </td>
                    <td className="mono">
                      {h.from}–{h.to}
                    </td>
                    <td>
                      {h.inRange}/{h.expected}
                    </td>
                    <td>{h.missingTag + h.wrongTag}</td>
                    <td>
                      <StatusPill status={h.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="split">
        <article className="panel">
          <div className="panel-head">
            <h2>Serial / EPIC integrity</h2>
            <StatusPill
              status={report.serialInfo.gapCount === 0 && report.serialInfo.dupCount === 0 ? 'ok' : 'fail'}
            />
          </div>
          <div className="meta-strip">
            <div>
              <span>Gaps</span>
              <strong>{report.serialInfo.gapCount}</strong>
            </div>
            <div>
              <span>Dup serials</span>
              <strong>{report.serialInfo.dupCount}</strong>
            </div>
            <div>
              <span>Dup EPICs</span>
              <strong>{report.epicDups.length}</strong>
            </div>
            <div>
              <span>Bad EPIC</span>
              <strong>{report.epicBadCount}</strong>
            </div>
          </div>
          {report.epicDups.length ? (
            <div className="table-wrap flat" style={{ marginTop: '0.75rem' }}>
              <table className="voter-table compact-table">
                <thead>
                  <tr>
                    <th>EPIC</th>
                    <th>Count</th>
                    <th>Serials</th>
                  </tr>
                </thead>
                <tbody>
                  {report.epicDups.slice(0, 8).map((d) => (
                    <tr key={d.epic}>
                      <td>
                        <button type="button" className="cell-btn mono" onClick={() => openVoter(d.epic)}>
                          {d.epic}
                        </button>
                      </td>
                      <td>{d.count}</td>
                      <td className="mono">{d.serials.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </article>

        <article className="panel">
          <div className="panel-head">
            <h2>Field coverage</h2>
            <span className="muted">Extract completeness</span>
          </div>
          <div className="table-wrap flat">
            <table className="voter-table compact-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th className="num">Present</th>
                  <th>Coverage</th>
                </tr>
              </thead>
              <tbody>
                {report.fieldCoverage.map((f) => (
                  <tr key={f.field}>
                    <td>{f.field}</td>
                    <td className="num">{f.count.toLocaleString()}</td>
                    <td>
                      <span className={f.pct >= 99 ? 'ok-pill' : f.pct >= 90 ? 'warn-pill' : 'bad-pill'}>
                        {f.pct}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="split">
        <article className="panel mix-panel">
          <div className="panel-head">
            <h2>Age bands</h2>
            <span className="muted">{totals.electors.toLocaleString()}</span>
          </div>
          <MixBars items={stats.ageBands} accent="teal" />
        </article>
        <article className="panel mix-panel">
          <div className="panel-head">
            <h2>Gender mix</h2>
          </div>
          <MixBars items={genderMix} accent="amber" />
        </article>
      </section>

      <section className="split">
        <article className="panel mix-panel">
          <div className="panel-head">
            <h2>Household size mix</h2>
            <Link to="/families">Families</Link>
          </div>
          <MixBars items={famStats.sizeBands} accent="amber" />
        </article>
        <article className="panel">
          <div className="panel-head">
            <h2>Electors by polling station</h2>
            <Link to="/wards">Wards</Link>
          </div>
          <PartElectorsChart voters={voters} total={totals.electors} />
        </article>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Ward-wise cross-check</h2>
          <span className="muted">Extracted vs cover net · S.No gaps · missing fields</span>
        </div>
        <div className="table-wrap">
          <table className="voter-table">
            <thead>
              <tr>
                <th>Ward</th>
                <th>Extracted</th>
                <th>Cover net</th>
                <th>Δ Total</th>
                <th>Δ M / F</th>
                <th>S.No range</th>
                <th>Gaps</th>
                <th>Miss rel</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => (
                <tr key={p.part} className={p.status !== 'ok' ? 'row-warn' : ''}>
                  <td>
                    <Link className="cell-link" to={`/wards/${p.part}`}>
                      Ward {p.part}
                    </Link>
                    <div className="muted small">
                      {normalizeBoothName(p.pollingStationName) || p.pollingStationName}
                    </div>
                  </td>
                  <td>{p.electors.toLocaleString()}</td>
                  <td>{p.netTotal != null ? Number(p.netTotal).toLocaleString() : '—'}</td>
                  <td>
                    <span className={deltaClass(p.deltaTotal)}>{fmtDelta(p.deltaTotal)}</span>
                  </td>
                  <td className="mono">
                    <span className={deltaClass(p.deltaMale)}>{fmtDelta(p.deltaMale)}</span>
                    {' / '}
                    <span className={deltaClass(p.deltaFemale)}>{fmtDelta(p.deltaFemale)}</span>
                  </td>
                  <td className="mono">
                    {p.serialMin != null ? `${p.serialMin}–${p.serialMax}` : '—'}
                  </td>
                  <td>
                    {p.serialGaps ? (
                      <span className="warn-pill" title={p.serialGapSample?.join(', ')}>
                        {p.serialGaps}
                      </span>
                    ) : (
                      <span className="muted">0</span>
                    )}
                  </td>
                  <td>{p.missingRelation || 0}</td>
                  <td>
                    <span
                      className={
                        p.status === 'ok' ? 'ok-pill' : p.status === 'warn' ? 'warn-pill' : 'bad-pill'
                      }
                    >
                      {p.status === 'ok' ? 'OK' : p.flags.join(', ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Ward-wise households</h2>
          <span className="muted">Households · relation links</span>
        </div>
        <div className="table-wrap">
          <table className="voter-table">
            <thead>
              <tr>
                <th>Ward</th>
                <th>Sections</th>
                <th>Electors</th>
                <th>M / F</th>
                <th>Households</th>
                <th>Links</th>
                <th>Unlinked</th>
                <th>Female %</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => (
                <tr key={`fam-${p.part}`}>
                  <td>
                    <Link className="cell-link" to={`/wards/${p.part}`}>
                      Ward {p.part}
                    </Link>
                  </td>
                  <td>{p.sections}</td>
                  <td>{p.electors.toLocaleString()}</td>
                  <td>
                    {p.male} / {p.female}
                  </td>
                  <td>
                    {p.households.toLocaleString()}
                    <div className="muted small">
                      {p.multiHouseholds} multi · {p.largeFamilies} large
                    </div>
                  </td>
                  <td>{p.links.toLocaleString()}</td>
                  <td>
                    {p.unlinked ? (
                      <span className="unlinked-tag">{p.unlinked}</span>
                    ) : (
                      <span className="muted">0</span>
                    )}
                  </td>
                  <td>{p.femaleShare}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Polling stations</h2>
          <span className="muted">{stations.length} stations</span>
        </div>
        <div className="table-wrap">
          <table className="voter-table">
            <thead>
              <tr>
                <th>Polling station</th>
                <th>Wards</th>
                <th>Electors</th>
                <th>M / F</th>
                <th>Female %</th>
                <th>Households</th>
              </tr>
            </thead>
            <tbody>
              {stations.map((s) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td className="mono">{s.parts}</td>
                  <td>{s.electors.toLocaleString()}</td>
                  <td>
                    {s.male} / {s.female}
                  </td>
                  <td>{s.femalePct}%</td>
                  <td>{s.households.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="split">
        <article className="panel">
          <div className="panel-head">
            <h2>Enrichment readiness</h2>
            <Link to="/families">Families</Link>
          </div>
          <div className="meta-strip">
            <div>
              <span>Households</span>
              <strong>{report.fam.households.toLocaleString()}</strong>
            </div>
            <div>
              <span>Relation links</span>
              <strong>{report.fam.links.toLocaleString()}</strong>
            </div>
            <div>
              <span>Unlinked</span>
              <strong>{report.fam.unlinked.toLocaleString()}</strong>
            </div>
            <div>
              <span>PDF photos</span>
              <strong>
                {report.enriched.photo}/{report.totals.total}
              </strong>
            </div>
            <div>
              <span>Field enriched</span>
              <strong>
                {report.enriched.any} · {report.enriched.phone} phone · {report.enriched.status} status
              </strong>
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <h2>Largest households</h2>
            <Link to="/families">All</Link>
          </div>
          <div className="table-wrap flat">
            <table className="voter-table compact-table">
              <thead>
                <tr>
                  <th>Ward</th>
                  <th>House</th>
                  <th>Head</th>
                  <th>Size</th>
                  <th>Unlinked</th>
                </tr>
              </thead>
              <tbody>
                {famStats.topFamilies.map((f) => (
                  <tr key={f.id}>
                    <td>{f.part}</td>
                    <td>
                      <Link className="cell-link" to={`/families/${encodeURIComponent(f.id)}`}>
                        {f.house}
                      </Link>
                    </td>
                    <td>{f.headName}</td>
                    <td>{f.size}</td>
                    <td>
                      {f.unlinkedCount ? (
                        <span className="unlinked-tag">{f.unlinkedCount}</span>
                      ) : (
                        <span className="muted">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="meta-strip consol-meta">
        <div>
          <span>Qualifying date</span>
          <strong>{stats.qualifyingDate || '—'}</strong>
        </div>
        <div>
          <span>Publication</span>
          <strong>{stats.dateOfPublication || '—'}</strong>
        </div>
        <div>
          <span>Revision</span>
          <strong>{stats.typeOfRevision || '—'}</strong>
        </div>
        <div>
          <span>Hierarchy</span>
          <strong>AC → Ward → Village → House → Voter</strong>
        </div>
      </section>
    </div>
  )
}
