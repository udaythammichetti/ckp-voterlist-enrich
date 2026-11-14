import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { houseKey } from '../lib/families'
import {
  RELATION_TYPES,
  VOTER_STATUSES,
  statusLabel,
} from '../lib/enrichment'
import { useLocale } from '../context/Locale'
import { useVoterData } from '../context/VoterData'
import TeText from './TeText'
import VoterPhoto from './VoterPhoto'

function Row({ label, children }) {
  if (children == null || children === '') return null
  return (
    <div className="vd-row">
      <span className="vd-label">{label}</span>
      <span className="vd-value">{children}</span>
    </div>
  )
}

function fieldStateFromVoter(v) {
  return {
    name: v.name || '',
    relationType: v.relationType || '',
    relationName: v.relationName || '',
    house: v.house || '',
    phone: v.phone || '',
    currentAddress: v.currentAddress || '',
    notes: v.notes || '',
    voterStatus: v.voterStatus || '',
  }
}

export default function VoterDetailModal() {
  const { selectedVoter: v, closeVoter, updateVoterEnrichment } = useVoterData()
  const { t } = useLocale()
  const [form, setForm] = useState(() => fieldStateFromVoter({}))
  const [savedFlash, setSavedFlash] = useState(false)
  const panelRef = useRef(null)

  useEffect(() => {
    if (!v) return undefined
    setForm(fieldStateFromVoter(v))
    setSavedFlash(false)
    const onKey = (e) => {
      if (e.key === 'Escape') closeVoter()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const tmr = setTimeout(() => {
      const key = v.focusField || 'phone'
      const el = panelRef.current?.querySelector(`[data-focus="${key}"]`)
      el?.focus?.()
    }, 50)
    return () => {
      clearTimeout(tmr)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [v, closeVoter])

  if (!v) return null

  const familyId = v.house ? houseKey(v.part ?? v.ward, form.house || v.house) : null
  const baseline = fieldStateFromVoter(v)
  const dirty = Object.keys(baseline).some((k) => String(form[k] ?? '') !== String(baseline[k] ?? ''))

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  const save = () => {
    updateVoterEnrichment(v.epic, {
      name: form.name.trim(),
      relationType: form.relationType,
      relationName: form.relationName.trim(),
      house: form.house.trim(),
      phone: form.phone.trim(),
      currentAddress: form.currentAddress.trim(),
      notes: form.notes.trim(),
      voterStatus: form.voterStatus,
    })
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1800)
  }

  return (
    <div className="vd-backdrop" onClick={closeVoter} role="presentation">
      <aside
        ref={panelRef}
        className="vd-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Voter ${v.name || v.epic}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="vd-head">
          <div className="vd-head-main">
            <VoterPhoto voter={v} size={72} className="vd-photo" />
            <div>
              <p className="vd-eyebrow">
                Elector detail
                {form.voterStatus || v.voterStatus ? (
                  <span className={`status-pill status-${form.voterStatus || v.voterStatus}`}>
                    {statusLabel(form.voterStatus || v.voterStatus)}
                  </span>
                ) : null}
              </p>
              <h2>
                <TeText value={form.name || v.name || '—'} teValue={v.nameTe} />
              </h2>
              <p className="mono vd-epic">{v.epic || '—'}</p>
            </div>
          </div>
          <button type="button" className="ghost-btn vd-close" onClick={closeVoter} aria-label="Close">
            Close
          </button>
        </header>

        <section className="vd-block vd-enrich vd-enrich-primary">
          <h3>Update</h3>
          <p className="muted small" style={{ marginTop: 0 }}>
            Save here, then use <strong>Save version</strong> on Voters to update project latest.
          </p>

          <div className="vd-enrich-grid">
            <label className="vd-field">
              <span>Name</span>
              <input
                data-focus="name"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
              />
            </label>
            <label className="vd-field">
              <span>House No</span>
              <input
                data-focus="house"
                value={form.house}
                onChange={(e) => setField('house', e.target.value)}
              />
            </label>
          </div>

          <div className="vd-enrich-grid">
            <label className="vd-field">
              <span>Relation type</span>
              <select
                value={form.relationType}
                onChange={(e) => setField('relationType', e.target.value)}
              >
                {RELATION_TYPES.map((r) => (
                  <option key={r || 'blank'} value={r}>
                    {r || 'Not set'}
                  </option>
                ))}
              </select>
            </label>
            <label className="vd-field">
              <span>Relation name</span>
              <input
                value={form.relationName}
                onChange={(e) => setField('relationName', e.target.value)}
                placeholder="Father / husband / mother name"
              />
            </label>
          </div>

          <label className="vd-field">
            <span>Status</span>
            <select
              value={form.voterStatus}
              onChange={(e) => setField('voterStatus', e.target.value)}
            >
              {VOTER_STATUSES.map((s) => (
                <option key={s.value || 'blank'} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <div className="vd-enrich-grid">
            <label className="vd-field">
              <span>Phone</span>
              <input
                data-focus="phone"
                value={form.phone}
                onChange={(e) => setField('phone', e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (dirty) save()
                  }
                }}
                placeholder="e.g. 9876543210"
                inputMode="tel"
                autoComplete="tel"
              />
            </label>
            <label className="vd-field">
              <span>Current address</span>
              <input
                data-focus="address"
                value={form.currentAddress}
                onChange={(e) => setField('currentAddress', e.target.value)}
                placeholder="Present address if different"
              />
            </label>
          </div>

          <label className="vd-field">
            <span>Notes (optional)</span>
            <textarea
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              placeholder="Visit notes, family tip, follow-up…"
              rows={2}
            />
          </label>

          <div className="vd-enrich-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={save}
              disabled={!dirty && !savedFlash}
            >
              {savedFlash ? 'Saved ✓' : dirty ? 'Save updates' : 'Up to date'}
            </button>
            <span className="muted small">
              Stored locally · export a versioned file from Voters to keep a copy
            </span>
          </div>
        </section>

        <div className="vd-grid">
          <section className="vd-block">
            <h3>Roll identity</h3>
            <Row label="S.No">{v.serial ?? '—'}</Row>
            <Row label="Voter ID">
              <span className="mono">{v.epic || '—'}</span>
            </Row>
            <Row label={t('Name')}>
              <TeText value={form.name || v.name || '—'} teValue={v.nameTe} />
            </Row>
            <Row label={t('Age')}>{v.age != null ? `${v.age} yrs` : '—'}</Row>
            <Row label={t('Gender')}>{v.gender ? t(v.gender) : '—'}</Row>
            <Row label={t('Relation')}>
              {form.relationType || v.relationType ? (
                <>
                  {t(form.relationType || v.relationType)}:{' '}
                  {form.relationName || v.relationName || '—'}
                </>
              ) : (
                '—'
              )}
            </Row>
            <Row label="House No">
              {familyId ? (
                <Link
                  className="cell-link"
                  to={`/families/${encodeURIComponent(familyId)}`}
                  onClick={closeVoter}
                >
                  {form.house || v.house}
                </Link>
              ) : (
                form.house || v.house || '—'
              )}
            </Row>
            <Row label="Phone">{form.phone || '—'}</Row>
            <Row label="Current address">{form.currentAddress || '—'}</Row>
            <Row label="Status">{statusLabel(form.voterStatus)}</Row>
          </section>

          <section className="vd-block">
            <h3>Hierarchy</h3>
            <Row label="Campaign">Chukkavaripalli · Sarpanch 2026</Row>
            <Row label="Ward">
              {v.ward != null || v.part != null ? (
                <Link className="cell-link" to={`/wards/${v.ward ?? v.part}`} onClick={closeVoter}>
                  Ward {v.ward ?? v.part}
                </Link>
              ) : (
                '—'
              )}
            </Row>
            <Row label="Village">
              {v.habitation ? (
                <Link
                  className="cell-link"
                  to={`/villages/${encodeURIComponent(v.habitationId ?? v.habitation)}`}
                  onClick={closeVoter}
                >
                  <TeText value={v.habitation} teValue={v.habitationTe} />
                </Link>
              ) : (
                '—'
              )}
            </Row>
            <Row label="Assembly">{v.constituency || '—'}</Row>
            <Row label="District">{v.district || '—'}</Row>
            <Row label="Mandal">{v.tehsilMandal || '—'}</Row>
          </section>
        </div>

        <footer className="vd-foot">
          {familyId ? (
            <Link
              className="secondary-btn"
              to={`/families/${encodeURIComponent(familyId)}`}
              onClick={closeVoter}
            >
              Open family tree
            </Link>
          ) : null}
          <Link className="ghost-btn" to="/voters" onClick={closeVoter}>
            All voters
          </Link>
        </footer>
      </aside>
    </div>
  )
}
