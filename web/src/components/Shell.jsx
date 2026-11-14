import { useEffect, useRef } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import VoterDetailModal from './VoterDetailModal'
import { useLocale } from '../context/Locale'
import { useVoterData } from '../context/VoterData'

const links = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/voters', label: 'Voters' },
  { to: '/families', label: 'Families' },
  { to: '/wards', label: 'Wards' },
  { to: '/villages', label: 'Villages' },
  { to: '/campaign', label: 'Campaign' },
  { to: '/consolidated', label: 'Consolidated' },
]

function titleForPath(pathname) {
  if (pathname === '/') return 'Dashboard'
  if (pathname.startsWith('/voters')) return 'Voters'
  if (pathname.startsWith('/families')) return 'Families'
  if (pathname.startsWith('/wards') || pathname.startsWith('/parts')) return 'Wards'
  if (pathname.startsWith('/villages')) return 'Villages'
  if (pathname.startsWith('/campaign')) return 'Campaign'
  if (pathname.startsWith('/consolidated') || pathname.startsWith('/validation')) {
    return 'Consolidated'
  }
  return 'Chukkavaripalli'
}

function pathMatches(to, pathname, end) {
  if (end) return pathname === to
  if (to === '/') return pathname === '/'
  return pathname === to || pathname.startsWith(`${to}/`)
}

export default function Shell() {
  const { loading, voters, dbLive } = useVoterData()
  const { lang, setLanguage, t } = useLocale()
  const { pathname } = useLocation()
  const navRef = useRef(null)

  useEffect(() => {
    document.title = `${t(titleForPath(pathname))} · Chukkavaripalli`
    document.documentElement.lang = lang === 'te' ? 'te' : 'en'
  }, [pathname, lang, t])

  // Scroll active tab inside the nav scroller only (don't jump the page).
  useEffect(() => {
    const nav = navRef.current
    if (!nav) return undefined
    const active = nav.querySelector('.nav.active')
    if (!active) return undefined

    const frame = requestAnimationFrame(() => {
      const navRect = nav.getBoundingClientRect()
      const activeRect = active.getBoundingClientRect()
      const delta =
        activeRect.left - navRect.left - (navRect.width - activeRect.width) / 2
      nav.scrollBy({ left: delta, behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [pathname, lang])

  // New page → start at top (mobile feels broken otherwise).
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <Link to="/" className="brand-home" aria-label="Home dashboard">
            <p className="brand-kicker">Sarpanch 2026</p>
            <p className="brand-mark">Chukkavaripalli</p>
          </Link>
          <p className="brand-sub">
            {!loading ? `${voters.length.toLocaleString()} electors` : 'Loading…'}
            {dbLive ? <span className="db-live"> · Live DB</span> : null}
          </p>
        </div>
        <div className="topbar-right">
          <div className="lang-toggle" role="group" aria-label="Language">
            <button
              type="button"
              className={lang === 'en' ? 'is-active' : ''}
              onClick={() => setLanguage('en')}
            >
              EN
            </button>
            <button
              type="button"
              className={lang === 'te' ? 'is-active' : ''}
              onClick={() => setLanguage('te')}
            >
              తెలుగు
            </button>
          </div>
          <nav ref={navRef} className="nav-links" aria-label="Primary">
            {links.map((l) => {
              const active = pathMatches(l.to, pathname, l.end)
              return (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.end}
                  className={() => (active ? 'nav active' : 'nav')}
                  aria-current={active ? 'page' : undefined}
                >
                  {t(l.label)}
                </NavLink>
              )
            })}
          </nav>
          <a className="logout-link" href="/logout">
            Logout
          </a>
        </div>
      </header>
      <p className="print-only print-banner">
        Chukkavaripalli · {lang === 'te' ? 'తెలుగు' : 'English'} · {t(titleForPath(pathname))}
      </p>
      <main className="page">
        <Outlet />
      </main>
      <VoterDetailModal />
    </div>
  )
}
