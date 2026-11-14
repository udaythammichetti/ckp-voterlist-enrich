import { useEffect, useRef, useState } from 'react'
import { exportVotersLocalized } from '../lib/exportCsv'
import { useLocale } from '../context/Locale'
import { useVoterData } from '../context/VoterData'

/**
 * Print / CSV / Data menu (latest + backups; never overwrites voters.json).
 */
export default function ExportPrintBar({
  rows = [],
  exportName = 'chukkavaripalli_voters.csv',
  className = '',
  compact = false,
  showVersionSave = false,
}) {
  const { lang, t, isTe } = useLocale()
  const {
    saveVotersVersion,
    saveEnrichmentPatch,
    importVotersFile,
    resetToOriginalRoll,
    listVersionBackups,
    restoreVersionBackup,
    dataSource,
  } = useVoterData()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [backups, setBackups] = useState({ browser: [], disk: [] })
  const fileRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return undefined
    const onDoc = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen || !showVersionSave) return undefined
    let alive = true
    listVersionBackups()
      .then((b) => {
        if (alive) setBackups(b)
      })
      .catch(() => {
        if (alive) setBackups({ browser: [], disk: [] })
      })
    return () => {
      alive = false
    }
  }, [menuOpen, showVersionSave, listVersionBackups])

  async function onExport() {
    if (!rows.length || busy) return
    setBusy(true)
    setStatus(isTe ? t('Preparing Telugu names…') : '')
    try {
      await exportVotersLocalized(rows, {
        lang,
        filename: exportName,
        onStatus: setStatus,
      })
    } finally {
      setBusy(false)
      setTimeout(() => setStatus(''), 2500)
    }
  }

  function flash(msg, ms = 5000) {
    setStatus(msg)
    setTimeout(() => setStatus(''), ms)
  }

  async function onSaveVersion() {
    setMenuOpen(false)
    setBusy(true)
    try {
      const result = await saveVotersVersion()
      flash(
        `Project updated · voters_latest.json · backup ${result.filename}${
          result.backupCount ? ` · ${result.backupCount} versions` : ''
        }`,
        6000,
      )
    } catch (e) {
      flash(e.message || 'Save failed — start Vite so project folder can update')
    } finally {
      setBusy(false)
    }
  }

  function onSavePatch() {
    setMenuOpen(false)
    try {
      const { filename } = saveEnrichmentPatch()
      flash(`Saved ${filename}`)
    } catch (e) {
      flash(e.message || 'Save failed')
    }
  }

  async function onImportFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const result = await importVotersFile(file)
      flash(`Loaded ${result.sourceLabel} · set as latest · prior list backed up`)
    } catch (err) {
      flash(err.message || 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  async function onReset() {
    setMenuOpen(false)
    if (!window.confirm('Reload original voters.json? Current list will be backed up first.')) return
    setBusy(true)
    try {
      await resetToOriginalRoll()
      flash('Original roll loaded · previous list kept in backups')
    } catch (e) {
      flash(e.message || 'Reset failed')
    } finally {
      setBusy(false)
    }
  }

  async function onRestoreBackup(id) {
    setMenuOpen(false)
    setBusy(true)
    try {
      const result = await restoreVersionBackup(id)
      flash(`Restored ${result.sourceLabel} · ${result.count.toLocaleString()} electors`)
    } catch (e) {
      flash(e.message || 'Restore failed')
    } finally {
      setBusy(false)
    }
  }

  const shortSource = dataSource
    ? dataSource.replace(/^voters_enriched_/, 'v').replace(/\.json$/i, '')
    : ''

  function fmtWhen(iso) {
    if (!iso) return ''
    try {
      return new Date(iso).toLocaleString()
    } catch {
      return iso
    }
  }

  return (
    <div className={`export-print-bar no-print ${className}`.trim()}>
      <button type="button" className="ghost-btn toolbar-btn" onClick={() => window.print()}>
        {t('Print')}
      </button>
      <button
        type="button"
        className="ghost-btn toolbar-btn"
        onClick={onExport}
        disabled={busy || !rows.length}
        title={rows.length ? `${rows.length.toLocaleString()} rows · ${isTe ? 'తెలుగు' : 'EN'}` : undefined}
      >
        {busy ? t('Preparing…') : t('Export CSV')}
        {!compact && !busy ? (
          <span className="export-lang-tag">{isTe ? 'TE' : 'EN'}</span>
        ) : null}
      </button>

      {showVersionSave ? (
        <button
          type="button"
          className="secondary-btn toolbar-btn"
          onClick={onSaveVersion}
          disabled={busy || !rows.length}
          title="Writes web/public/data/voters_latest.json + versions backup. App reloads from that latest. Original voters.json is not changed."
        >
          Save version
        </button>
      ) : null}

      {showVersionSave ? (
        <div className="data-menu" ref={menuRef}>
          <button
            type="button"
            className={`ghost-btn toolbar-btn data-menu-trigger ${menuOpen ? 'is-open' : ''}`}
            onClick={() => setMenuOpen((o) => !o)}
            disabled={busy}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={dataSource ? `Active data: ${dataSource}` : 'More data options'}
          >
            More
            {shortSource ? <span className="data-menu-chip">{shortSource}</span> : null}
            <span className="data-menu-caret" aria-hidden>
              ▾
            </span>
          </button>

          {menuOpen ? (
            <div className="data-menu-panel" role="menu">
              <p className="data-menu-heading">More options</p>
              {dataSource ? (
                <p className="data-menu-source muted small">Using {dataSource}</p>
              ) : null}

              <button
                type="button"
                role="menuitem"
                className="data-menu-item"
                onClick={onSavePatch}
                disabled={busy}
              >
                <strong>Save patch</strong>
                <span>Field updates only (small file)</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="data-menu-item"
                onClick={() => {
                  setMenuOpen(false)
                  fileRef.current?.click()
                }}
                disabled={busy}
              >
                <strong>Load file</strong>
                <span>Open JSON · becomes latest · current list backed up</span>
              </button>

              {(backups.browser?.length || backups.disk?.length) ? (
                <>
                  <div className="data-menu-sep" />
                  <p className="data-menu-heading">Backups</p>
                  {backups.browser.slice(0, 4).map((b) => (
                    <button
                      key={`b-${b.id}`}
                      type="button"
                      role="menuitem"
                      className="data-menu-item"
                      onClick={() => onRestoreBackup(b.id)}
                      disabled={busy}
                    >
                      <strong>Restore · {b.sourceLabel || b.id}</strong>
                      <span>
                        {fmtWhen(b.savedAt)}
                        {b.electorCount ? ` · ${b.electorCount} electors` : ''}
                      </span>
                    </button>
                  ))}
                  {backups.disk.slice(0, 3).map((b) => (
                    <a
                      key={`d-${b.id}`}
                      className="data-menu-item data-menu-link"
                      href={b.url}
                      download={b.id}
                      onClick={() => setMenuOpen(false)}
                    >
                      <strong>Disk · {b.sourceLabel}</strong>
                      <span>{fmtWhen(b.savedAt)} · download backup</span>
                    </a>
                  ))}
                </>
              ) : null}

              <div className="data-menu-sep" />

              <button
                type="button"
                role="menuitem"
                className="data-menu-item is-danger"
                onClick={onReset}
                disabled={busy}
              >
                <strong>Original roll</strong>
                <span>Reset to voters.json · current list backed up first</span>
              </button>
            </div>
          ) : null}

          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={onImportFile}
          />
        </div>
      ) : null}

      {status ? <span className="export-status muted small">{status}</span> : null}
    </div>
  )
}
