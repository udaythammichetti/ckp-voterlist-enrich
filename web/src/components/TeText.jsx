import { useLocale } from '../context/Locale'

/**
 * Shows English by default; in Telugu mode prefers provided teValue (from PDF).
 */
export default function TeText({ value, teValue, className, as: Tag = 'span' }) {
  const { isTe } = useLocale()
  const en = value == null ? '' : String(value)
  const te = teValue == null ? '' : String(teValue)
  const shown = isTe && te ? te : en

  return (
    <Tag
      className={className}
      title={isTe && te && te !== en ? en : undefined}
      lang={isTe && te ? 'te' : 'en'}
    >
      {shown || '—'}
    </Tag>
  )
}
