import type { ContactPerson } from '@/types'

/** Accepts either a plain array or a `{ items, pagination }` envelope. */
export function unwrapList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: T[] }).items
  }
  return []
}

export function errorMessage(err: unknown, fallback = 'Something went wrong') {
  if (err instanceof Error && err.message) return err.message
  return fallback
}

export function uploadUrl(file?: string | null) {
  if (!file) return ''
  const base = String(file).split('/').pop() || ''
  return `/uploads/${encodeURIComponent(base)}`
}

export function displayFileName(file?: string | null) {
  if (!file) return ''
  return String(file).split('/').pop() || ''
}

export function compareValues(a: unknown, b: unknown) {
  const an = typeof a === 'number' ? a : Number.NaN
  const bn = typeof b === 'number' ? b : Number.NaN
  if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, {
    sensitivity: 'base',
    numeric: true,
  })
}

export function includesText(haystack: unknown[], needle: string) {
  const q = needle.trim().toLowerCase()
  if (!q) return true
  return haystack.some((v) => String(v ?? '').toLowerCase().includes(q))
}

export function contactsSummary(list?: ContactPerson[]) {
  const names = (list || [])
    .map((c) => c.name || c.email || '')
    .filter(Boolean)
  if (!names.length) return ''
  if (names.length === 1) return names[0]
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 2).join(', ')} +${names.length - 2} more`
}

export function firstEmail(list?: ContactPerson[], fallback?: string) {
  const fromContacts = (list || []).map((c) => (c.email || '').trim()).find(Boolean)
  return fromContacts || (fallback || '').trim()
}

export function contactSearchBlob(list?: ContactPerson[]) {
  return (list || [])
    .map((c) => [c.name, c.email, c.mobile, c.tel, c.department].filter(Boolean).join(' '))
    .join(' ')
}

export function cleanContacts(list: ContactPerson[]) {
  return list
    .map((c) => {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(c)) out[k] = typeof v === 'string' ? v.trim() : ''
      return out as ContactPerson
    })
    .filter((c) => c.name || c.email)
}

/** Returns a number if parseable, otherwise undefined. */
export function toNumber(value: string | number | null | undefined) {
  if (value === '' || value == null) return undefined
  const n = Number(value)
  return Number.isNaN(n) ? undefined : n
}
