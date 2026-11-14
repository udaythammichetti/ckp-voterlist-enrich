export default function KpiGrid({ items, className = '' }) {
  return (
    <div className={`kpi-grid ${className}`.trim()}>
      {items.map((item) => (
        <article
          key={item.label}
          className={`kpi ${item.tone ? `kpi-${item.tone}` : ''} ${item.onClick ? 'is-clickable' : ''}`.trim()}
          onClick={item.onClick}
          role={item.onClick ? 'button' : undefined}
          tabIndex={item.onClick ? 0 : undefined}
          onKeyDown={
            item.onClick
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    item.onClick()
                  }
                }
              : undefined
          }
        >
          <p className="kpi-label">{item.label}</p>
          <p className="kpi-value">{item.value}</p>
          {item.hint ? <p className="kpi-hint">{item.hint}</p> : null}
        </article>
      ))}
    </div>
  )
}
