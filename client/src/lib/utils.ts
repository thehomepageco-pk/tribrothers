import clsx, { type ClassValue } from 'clsx'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

export function idOf(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && '_id' in value) {
    return String((value as { _id: unknown })._id)
  }
  return String(value)
}

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i

/** True when a nameOf() result is a real label (not the empty placeholder). */
export function hasDisplayName(value: string | null | undefined): boolean {
  return !!value && value !== '—' && !OBJECT_ID_RE.test(value)
}

/**
 * Join a resolved name with detail text.
 * Skips the name (and separator) when the name is missing — avoids "—: 12" / "— 12 MT".
 */
export function withDisplayName(name: string, detail: string, sep = ' — '): string {
  return hasDisplayName(name) ? `${name}${sep}${detail}` : detail
}

export function nameOf(
  value: unknown,
  keys: string[] = ['name', 'companyName', 'username', 'invoiceNumber', 'contractNumber'],
): string {
  if (!value) return '—'
  if (typeof value === 'string') {
    // Unpopulated ObjectId refs often arrive as bare hex strings — not a display name.
    if (OBJECT_ID_RE.test(value.trim())) return '—'
    return value
  }
  if (typeof value === 'object' && value !== null) {
    for (const key of keys) {
      const v = (value as Record<string, unknown>)[key]
      if (typeof v === 'string' && v.trim()) return v
    }
  }
  return '—'
}

export function formatDate(value?: string | Date | null) {
  if (!value) return '—'
  const d = typeof value === 'string' || value instanceof Date ? new Date(value) : null
  if (!d || Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatMoney(amount?: number | null, currency = 'USD') {
  if (amount == null || Number.isNaN(Number(amount))) return '—'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(Number(amount))
  } catch {
    return `${currency} ${Number(amount).toFixed(2)}`
  }
}

export function toDateInput(value?: string | Date | null) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function downloadExport(type: string) {
  const res = await fetch(`/api/export/${type}`, { credentials: 'same-origin' })
  if (!res.ok) throw new Error('Export failed')
  const blob = await res.blob()
  downloadBlob(blob, `${type}.csv`)
}
