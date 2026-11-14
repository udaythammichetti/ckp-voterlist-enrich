/** Compact horizontal bar list for ward / village rollups. */

export default function BarList({ items = [], valueKey = 'total', labelKey = 'label', maxBars = 12, onClick }) {
  const rows = items.slice(0, maxBars)
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0))

  if (!rows.length) return <p className="muted small">No data</p>

  return (
    <ul className="bar-list">
      {rows.map((row) => {
        const value = Number(row[valueKey]) || 0
        const pct = Math.round((value / max) * 100)
        const label = row[labelKey] || row.label || '—'
        const content = (
          <>
            <div className="bar-list-meta">
              <span className="bar-list-label">{label}</span>
              <span className="bar-list-value">
                {value.toLocaleString()}
                {row.male != null ? (
                  <span className="muted small"> · {row.male}M / {row.female}F</span>
                ) : null}
              </span>
            </div>
            <div className="bar-list-track" aria-hidden>
              <div className="bar-list-fill" style={{ width: `${pct}%` }} />
            </div>
          </>
        )
        return (
          <li key={row.key || label}>
            {onClick ? (
              <button type="button" className="bar-list-btn" onClick={() => onClick(row)}>
                {content}
              </button>
            ) : (
              content
            )}
          </li>
        )
      })}
    </ul>
  )
}
