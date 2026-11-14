import { useEffect, useRef } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import VoterDetailModal from './VoterDetailModal'
import { useLocale } from '../context/Locale'
import { useVoterData } from '../context/VoterData'

const links = [
  { to: '/', label: 'Dashboard', short: 'Home', end: true },
  { to: '/voters', label: 'Voters', short: 'Voters' },
  { to: '/families', label: 'Families', short: 'Family' },
  { to: '/wards', label: 'Wards', short: 'Wards' },
  { to: '/villages', label: 'Villages', short: 'Village' },
  { to: '/campaign', label: 'Campaign', short: 'Campaign' },
  { to: '/consolidated', label: 'Consolidated', short: 'Report' },
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

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-row">
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
          <div className="topbar-tools">
            <div className="lang-toggle" role="group" aria-label="Language">
              <button
                type="button"
                className={lang === 'en' ? 'is-active' : ''}
                onClick={() => setLanguage('en')}
                aria-pressed={lang === 'en'}
              >
                EN
              </button>
              <button
                type="button"
                className={lang === 'te' ? 'is-active' : ''}
                onClick={() => setLanguage('te')}
                aria-pressed={lang === 'te'}
              >
                <span className="lang-full">తెలుగు</span>
                <span className="lang-short">తె</span>
              </button>
            </div>
            <a className="logout-link" href="/logout" title="Sign out">
              Logout
            </a>
          </div>
        </div>

        <nav ref={navRef} className="nav-rail" aria-label="Primary">
          <div className="nav-links">
            {links.map((l) => {
              const active = pathMatches(l.to, pathname, l.end)
              return (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.end}
                  className={() => (active ? 'nav active' : 'nav')}
                  aria-current={active ? 'page' : undefined}
                  title={t(l.label)}
                >
                  <span className="nav-label-full">{t(l.label)}</span>
                  <span className="nav-label-short">{t(l.short)}</span>
                </NavLink>
              )
            })}
          </div>
        </nav>
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
