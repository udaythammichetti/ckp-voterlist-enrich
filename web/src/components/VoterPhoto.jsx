/** Voter portrait from PDF extract, with initials fallback. */

function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function VoterPhoto({ voter, size = 40, className = '', onClick }) {
  const src = voter?.photo || ''
  const label = voter?.name || voter?.epic || 'Voter'
  const genderClass =
    voter?.gender === 'Female' ? 'is-female' : voter?.gender === 'Male' ? 'is-male' : ''

  const style = { width: size, height: size }

  if (src) {
    const img = (
      <img
        className={`voter-photo ${genderClass} ${className}`.trim()}
        src={src}
        alt={label}
        width={size}
        height={size}
        loading="lazy"
        style={style}
      />
    )
    if (onClick) {
      return (
        <button type="button" className="voter-photo-btn" onClick={onClick} aria-label={`Open ${label}`}>
          {img}
        </button>
      )
    }
    return img
  }

  const fallback = (
    <span className={`voter-photo is-fallback ${genderClass} ${className}`.trim()} style={style}>
      {initials(voter?.name)}
    </span>
  )
  if (onClick) {
    return (
      <button type="button" className="voter-photo-btn" onClick={onClick} aria-label={`Open ${label}`}>
        {fallback}
      </button>
    )
  }
  return fallback
}
