/** Download rows as CSV (Excel-friendly UTF-8 BOM). Locale-aware EN | తెలుగు. */

import { tLabel } from './telugu'

function escapeCell(v) {
  const s = v == null ? '' : String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function downloadCsv(filename, columns, rows) {
  const parts = [columns.map((c) => escapeCell(c.label)).join(',')]
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    parts.push(columns.map((c) => escapeCell(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(','))
  }
  const blob = new Blob([`\uFEFF${parts.join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function voterCsvColumns(lang = 'en') {
  const L = (key) => tLabel(key, lang)
  const te = lang === 'te'

  return [
    { key: 'ward', label: 'Ward', value: (v) => v.ward ?? v.part ?? '' },
    { key: 'habitation', label: 'Village', value: (v) => (te ? v.habitationTe || v.habitation : v.habitation) || '' },
    { key: 'serial', label: L('S.No'), value: (v) => v.serial ?? v.serialRaw ?? '' },
    { key: 'epic', label: 'Voter ID' },
    {
      key: 'name',
      label: L('Name'),
      value: (v) => (te ? v.nameTe || v.name : v.name) || '',
    },
    {
      key: 'relationType',
      label: L('Relation Type'),
      value: (v) => (v.relationType ? L(v.relationType) : ''),
    },
    {
      key: 'relationName',
      label: L('Relation Name'),
      value: (v) => (te ? v.relationNameTe || v.relationName : v.relationName) || '',
    },
    { key: 'house', label: L('House No') },
    { key: 'age', label: L('Age') },
    {
      key: 'gender',
      label: L('Gender'),
      value: (v) => (v.gender ? L(v.gender) : ''),
    },
    { key: 'phone', label: 'Phone' },
    { key: 'currentAddress', label: 'Current Address' },
    { key: 'voterStatus', label: 'Status' },
    { key: 'notes', label: 'Notes' },
    { key: 'constituency', label: L('AC') },
    { key: 'page', label: L('PDF Page') },
  ]
}

/** @deprecated Prefer exportVotersLocalized — kept for English-only callers. */
export const VOTER_CSV_COLUMNS = voterCsvColumns('en')

function withLangSuffix(name, lang) {
  const stem = String(name || 'voters_export')
    .replace(/\.csv$/i, '')
    .replace(/_(en|te)$/i, '')
  return `${stem}_${lang}.csv`
}

/**
 * Export voters CSV in the active language.
 * Telugu: column headers + gender/relation labels in TE.
 * Names: use cache immediately; only fetch missing (with progress). Cap live fetches
 * so huge rolls stay usable — rest stay English until browsed/cached.
 */
export async function exportVotersLocalized(rows, options = {}) {
  const lang = options.lang === 'te' ? 'te' : 'en'
  const filename = withLangSuffix(options.filename || 'chukkavaripalli_voters.csv', lang)
  const columns = voterCsvColumns(lang)
  downloadCsv(filename, columns, rows)
  options.onStatus?.('')
}

export function exportVotersCsv(rows, filename = 'voters_export.csv') {
  downloadCsv(filename, voterCsvColumns('en'), rows)
}
