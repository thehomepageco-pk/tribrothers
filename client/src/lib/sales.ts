/** Small helpers shared by the sales-pipeline pages. */

export const QUANTITY_UNITS = ['MT', 'KGS'] as const
export type QuantityUnit = (typeof QUANTITY_UNITS)[number]

export const SHIPMENT_TYPES = ['FCL', 'LCL', 'Bulk'] as const
export const PAYMENT_METHODS = ['TT', 'Cash', 'Cheque', 'LC', 'Other'] as const

export type CurrencyOption = { code: string; name?: string }

/** Accept either a plain array or a paginated `{ items }` response. */
export function asList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === 'object') {
    const items = (data as { items?: unknown }).items
    if (Array.isArray(items)) return items as T[]
  }
  return []
}

export function errMsg(e: unknown, fallback = 'Something went wrong'): string {
  if (e instanceof Error && e.message) return e.message
  return fallback
}

export function toNum(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Trim floating point noise for quantity display. */
export function fmtQty(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return String(Math.round(n * 1000) / 1000)
}

export function todayInput() {
  return new Date().toISOString().slice(0, 10)
}

export function uploadUrl(filename?: string | null) {
  return filename ? `/uploads/${encodeURIComponent(filename)}` : ''
}

export function badgeClassForStatus(status?: string) {
  switch (status) {
    case 'Paid':
    case 'Delivered':
      return 'badge badge-success'
    case 'Partially paid':
    case 'In transit':
    case 'Sent':
      return 'badge badge-warning'
    case 'Cancelled':
    case 'Unpaid':
      return 'badge badge-error'
    case 'Booked':
    case 'Arrived':
      return 'badge badge-accent'
    default:
      return 'badge'
  }
}

/** Suggest the next `PREFIX-YYYY-NNN` number from existing numbers. */
export function suggestNumber(prefix: string, existing: Array<string | undefined>, pad = 3) {
  const year = new Date().getFullYear()
  const head = `${prefix}-${year}-`
  let max = 0
  for (const n of existing) {
    if (!n || !n.startsWith(head)) continue
    const m = n.match(/-(\d+)$/)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `${head}${String(max + 1).padStart(pad, '0')}`
}

let keyCounter = 0
export function newKey() {
  keyCounter += 1
  return `k${keyCounter}`
}
