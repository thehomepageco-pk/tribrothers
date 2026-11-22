import { useState , useEffect} from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { PageHeader } from '@/components/PageHeader'
import { formatDate } from '@/lib/utils'

type Mode = 'month' | 'year' | 'custom'
type Currency = 'USD' | 'PKR'

type Summary = {
  range?: { label?: string; mode?: string }
  currency?: { defaultCurrency?: string; usdToPkrRate?: number }
  stats?: Record<string, number | undefined>
  topClients?: Array<{ clientName?: string; totalQuoted?: number; count?: number }>
  topProducts?: Array<{ productName?: string; totalQuoted?: number; count?: number }>
}

type TimelineRow = {
  key: string
  label: string
  revenue?: number
  invoiceRevenue?: number
  commission?: number
  contractValue?: number
  contracts?: number
  indents?: number
  invoices?: number
  payments?: number
  quotations?: number
  offers?: number
}

type Timeline = { series?: TimelineRow[]; currency?: Summary['currency'] }

type MarginRow = {
  _id?: string
  productName?: string
  count?: number
  avgMargin?: number
  totalRevenue?: number
  avgPrice?: number
}

type ClientQuoteRow = { _id?: string; clientName?: string; count?: number; totalQuoted?: number; avgMargin?: number }

type SupplierPriceRow = {
  productName?: string
  category?: string
  suppliers?: Array<{ supplierName?: string; currency?: string; price?: number; moq?: number | string }>
}

type Operations = {
  indents?: Array<{
    _id?: string
    indentNumber?: string
    indentDate?: string
    contractNumber?: string
    clients?: string
    qtyMt?: number
    commissionPerMt?: number
    commissionCurrency?: string
    commissionUsd?: number
  }>
  contracts?: Array<{ contractNumber?: string; contractDate?: string; supplierName?: string; valueUsd?: number }>
  invoices?: Array<{
    invoiceNumber?: string
    invoiceDate?: string
    clientName?: string
    status?: string
    subtotalUsd?: number
  }>
  payments?: Array<{
    paymentDate?: string
    invoiceNumber?: string
    clientName?: string
    amountUsd?: number
    method?: string
  }>
  shipments?: Array<{ shipmentNumber?: string; status?: string; contractNumber?: string; blNumber?: string }>
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

function BarChart({
  rows,
  format,
  color = 'var(--accent)',
}: {
  rows: Array<{ label: string; value: number }>
  format: (v: number) => string
  color?: string
}) {
  const max = Math.max(...rows.map((r) => r.value), 0)
  if (rows.length === 0 || max <= 0) return <p className="empty-state">No data for this period.</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, marginBottom: 3 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
            <strong>{format(r.value)}</strong>
          </div>
          <div style={{ height: 8, borderRadius: 999, background: 'var(--bg-muted)', overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.max(2, (r.value / max) * 100)}%`,
                height: '100%',
                background: color,
                borderRadius: 999,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Vertical column chart for timeline series. */
function ColumnChart({
  rows,
  format,
  color = 'var(--accent)',
}: {
  rows: Array<{ label: string; value: number }>
  format: (v: number) => string
  color?: string
}) {
  const max = Math.max(...rows.map((r) => r.value), 0)
  if (rows.length === 0 || max <= 0) return <p className="empty-state">No data for this period.</p>
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 200, overflowX: 'auto', paddingTop: 8 }}>
      {rows.map((r, i) => (
        <div
          key={`${r.label}-${i}`}
          title={`${r.label}: ${format(r.value)}`}
          style={{ flex: '1 0 28px', minWidth: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}
        >
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.value ? format(r.value) : ''}</div>
          <div
            style={{
              width: '100%',
              height: `${Math.max(r.value > 0 ? 3 : 0, (r.value / max) * 100)}%`,
              background: color,
              borderRadius: '6px 6px 0 0',
              minHeight: r.value > 0 ? 3 : 0,
            }}
          />
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{r.label}</div>
        </div>
      ))}
    </div>
  )
}

function Delta({ cur, prev }: { cur: number; prev: number }) {
  const diff = cur - prev
  const text = !prev ? (cur ? '+100%' : '0%') : `${diff >= 0 ? '+' : ''}${((diff / prev) * 100).toFixed(1)}%`
  const color = diff > 0 ? 'var(--success)' : diff < 0 ? 'var(--error)' : 'var(--text-muted)'
  return (
    <div style={{ fontSize: 12, color, fontWeight: 600, marginTop: 2 }}>
      {text} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>vs prev period</span>
    </div>
  )
}

export default function ReportsPage() {
  useEffect(() => { document.title = 'Reports & Analytics'; }, [])

  const now = new Date()
  const [mode, setMode] = useState<Mode>('month')
  const [year, setYear] = useState(String(now.getFullYear()))
  const [month, setMonth] = useState(String(now.getMonth() + 1))
  const [from, setFrom] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10))
  const [to, setTo] = useState(now.toISOString().slice(0, 10))
  const [currency, setCurrency] = useState<Currency>('USD')
  const buildQs = () => {
    const p = new URLSearchParams()
    if (mode === 'custom') {
      p.set('from', from)
      p.set('to', to)
    } else {
      p.set('year', year)
      if (mode === 'month') p.set('month', month)
    }
    return p.toString()
  }
  const [activeQs, setActiveQs] = useState(buildQs)

  const enabled = true
  const summaryQ = useQuery({ queryKey: ['report-summary', activeQs], queryFn: () => api<Summary>(`/api/reports/summary?${activeQs}`), enabled })
  const timelineQ = useQuery({ queryKey: ['report-timeline', activeQs], queryFn: () => api<Timeline>(`/api/reports/timeline?${activeQs}`), enabled })
  const marginsQ = useQuery({ queryKey: ['report-margins', activeQs], queryFn: () => api<MarginRow[]>(`/api/reports/margins?${activeQs}`), enabled })
  const clientQuotesQ = useQuery({ queryKey: ['report-cq', activeQs], queryFn: () => api<ClientQuoteRow[]>(`/api/reports/quotations-by-client?${activeQs}`), enabled })
  const supplierPricesQ = useQuery({ queryKey: ['report-sp'], queryFn: () => api<SupplierPriceRow[]>('/api/reports/supplier-prices'), enabled })
  const opsQ = useQuery({ queryKey: ['report-ops', activeQs], queryFn: () => api<Operations>(`/api/reports/operations?${activeQs}`), enabled })

  const loading = summaryQ.isLoading || timelineQ.isLoading || opsQ.isLoading
  const firstError = [summaryQ, timelineQ, marginsQ, clientQuotesQ, opsQ].find((q) => q.error)?.error

  const summary = summaryQ.data
  const s = summary?.stats ?? {}
  const rate = n(summary?.currency?.usdToPkrRate ?? timelineQ.data?.currency?.usdToPkrRate) || 278

  const money = (v: unknown) => {
    const val = n(v) * (currency === 'PKR' ? rate : 1)
    const prefix = currency === 'PKR' ? 'PKR ' : '$'
    return prefix + val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  }

  // Harden mapping: API returns `{ series }`, but accept array / nested envelopes too.
  const series: TimelineRow[] = (() => {
    const raw: unknown = timelineQ.data
    if (!raw) return []
    if (Array.isArray(raw)) return raw as TimelineRow[]
    if (typeof raw === 'object') {
      const obj = raw as { series?: unknown; data?: unknown }
      if (Array.isArray(obj.series)) return obj.series as TimelineRow[]
      if (Array.isArray(obj.data)) return obj.data as TimelineRow[]
      if (obj.data && typeof obj.data === 'object' && Array.isArray((obj.data as { series?: unknown }).series)) {
        return (obj.data as { series: TimelineRow[] }).series
      }
    }
    return []
  })()
  const asRows = <T,>(data: unknown): T[] => {
    if (Array.isArray(data)) return data as T[]
    if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
      return (data as { items: T[] }).items
    }
    return []
  }
  const margins = asRows<MarginRow>(marginsQ.data)
  const clientQuotes = asRows<ClientQuoteRow>(clientQuotesQ.data)
  const supplierPrices = asRows<SupplierPriceRow>(supplierPricesQ.data)
  const ops = opsQ.data ?? {}

  const topClients = (summary?.topClients ?? []).map((c) => ({
    label: c.clientName || '—',
    value: n(c.totalQuoted),
  }))
  const topProducts = (summary?.topProducts ?? []).map((p) => ({
    label: p.productName || '—',
    value: n(p.totalQuoted),
  }))

  const years = Array.from({ length: 7 }, (_, i) => String(now.getFullYear() - i))

  const primaryStats = [
    { title: 'Business revenue', value: money(s.businessRevenue), cur: n(s.businessRevenue), prev: n(s.prevBusinessRevenue), sub: 'Invoices + commission' },
    { title: 'Commission earned', value: money(s.commissionTotal), cur: n(s.commissionTotal), prev: n(s.prevCommissionTotal), sub: `${n(s.indentQtyMt).toFixed(2)} MT indents` },
    { title: 'Invoiced', value: money(s.invoicedTotal), cur: n(s.invoicedTotal), prev: n(s.prevInvoicedTotal), sub: `${n(s.invoices)} invoices` },
    { title: 'Payments received', value: money(s.paymentsTotal), cur: n(s.paymentsTotal), prev: n(s.prevPaymentsTotal), sub: '' },
  ]
  const pipelineStats = [
    { title: 'Contract value', value: money(s.contractValue), cur: n(s.contractValue), prev: n(s.prevContractValue), sub: `${n(s.contracts)} contracts` },
    { title: 'Indents', value: String(n(s.indents)), cur: n(s.indents), prev: n(s.prevIndents), sub: '' },
    { title: 'Shipments', value: String(n(s.shipments)), cur: n(s.shipments), prev: n(s.prevShipments), sub: '' },
    { title: 'Total quoted', value: money(s.totalQuoted), cur: n(s.totalQuoted), prev: n(s.prevTotalQuoted), sub: `${n(s.quotations)} quotations · ${n(s.offers)} offers` },
  ]

  function download(format: 'csv' | 'html') {
    const url = `/api/reports/download?${activeQs}&format=${format}&type=full`
    if (format === 'html') window.open(url, '_blank')
    else window.location.href = url
  }

  const periodLabel = loading
    ? 'Loading…'
    : firstError
      ? 'Error loading report'
      : `${summary?.range?.label || '—'}${currency === 'PKR' ? ` · amounts in PKR @ ${rate}/USD` : ' · amounts in USD'}`

  const statCard = (st: (typeof primaryStats)[number]) => (
    <div className="kpi-card" key={st.title}>
      <div className="kpi-title">{st.title}</div>
      <div className="kpi-number">{loading ? '—' : st.value}</div>
      {!loading && <Delta cur={st.cur} prev={st.prev} />}
      {st.sub ? <div className="kpi-sub">{st.sub}</div> : null}
    </div>
  )

  return (
    <>
      <PageHeader eyebrow="System" title="Reports & Analytics" />

      <div className="products-toolbar list-toolbar">
        <div className="toolbar-row">
          <div className="toolbar-group toolbar-compact">
            <label htmlFor="r-mode">Period</label>
            <select id="r-mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="month">Monthly</option>
              <option value="year">Yearly (calendar)</option>
              <option value="custom">Custom range</option>
            </select>
          </div>
          {mode !== 'custom' && (
            <div className="toolbar-group toolbar-compact">
              <label htmlFor="r-year">Year</label>
              <select id="r-year" value={year} onChange={(e) => setYear(e.target.value)}>
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}
          {mode === 'month' && (
            <div className="toolbar-group toolbar-compact">
              <label htmlFor="r-month">Month</label>
              <select id="r-month" value={month} onChange={(e) => setMonth(e.target.value)}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
          )}
          {mode === 'custom' && (
            <>
              <div className="toolbar-group toolbar-compact">
                <label htmlFor="r-from">From</label>
                <input id="r-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="toolbar-group toolbar-compact">
                <label htmlFor="r-to">To</label>
                <input id="r-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </>
          )}
          <div className="toolbar-group toolbar-compact">
            <label htmlFor="r-cur">Currency</label>
            <select id="r-cur" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              <option value="USD">USD ($)</option>
              <option value="PKR">PKR (₨)</option>
            </select>
          </div>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-sm" onClick={() => setActiveQs(buildQs())}>
              Apply
            </button>
            <button type="button" className="action-btn" onClick={() => download('csv')}>
              CSV
            </button>
            <button type="button" className="action-btn" onClick={() => download('html')}>
              PDF
            </button>
          </div>
        </div>
      </div>

      <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
        Showing: <strong>{periodLabel}</strong>
      </p>

      {firstError ? (
        <div className="panel" role="alert" style={{ color: 'var(--error)' }}>
          {firstError instanceof Error ? firstError.message : 'Failed to load report'}
        </div>
      ) : null}

      <section className="kpi-row">{primaryStats.map(statCard)}</section>
      <section className="kpi-row">{pipelineStats.map(statCard)}</section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header"><h2 className="card-title">Revenue over time</h2></div>
          <div className="card-body">
            <ColumnChart
              rows={series.map((r) => {
                const invoiceRevenue = n(
                  r.invoiceRevenue ??
                    (r as { invoiced?: number }).invoiced ??
                    (r as { invoicedTotal?: number }).invoicedTotal,
                )
                const commission = n(r.commission ?? (r as { commissionTotal?: number }).commissionTotal)
                const revenue = (n(r.revenue) || invoiceRevenue + commission) * (currency === 'PKR' ? rate : 1)
                return { label: r.label, value: revenue }
              })}
              format={(v) => Math.round(v).toLocaleString()}
            />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h2 className="card-title">Pipeline activity</h2></div>
          <div className="card-body">
            <ColumnChart
              color="#7c3aed"
              rows={series.map((r) => ({ label: r.label, value: n(r.contracts) + n(r.indents) + n(r.invoices) + n(r.quotations) }))}
              format={(v) => String(Math.round(v))}
            />
            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8 }}>
              Quotations + contracts + indents + invoices per period.
            </p>
          </div>
        </div>
      </div>

      <h2 className="panel-title">Period breakdown</h2>
      <div className="table-wrap" style={{ marginBottom: 24 }}>
        <table>
          <thead>
            <tr>
              <th>Period</th><th>Contracts</th><th>Contract value</th><th>Indents</th><th>Commission</th>
              <th>Invoices</th><th>Invoiced</th><th>Payments</th><th>Revenue</th>
            </tr>
          </thead>
          <tbody>
            {series.length === 0 ? (
              <tr><td colSpan={9} className="empty-state">{loading ? 'Loading…' : 'No data for this period'}</td></tr>
            ) : (
              series.map((r) => {
                const contractValue = n(r.contractValue ?? (r as { contractsValue?: number }).contractsValue)
                const commission = n(r.commission ?? (r as { commissionTotal?: number }).commissionTotal)
                const invoiceRevenue = n(
                  r.invoiceRevenue ?? (r as { invoiced?: number; invoicedTotal?: number }).invoiced ?? (r as { invoicedTotal?: number }).invoicedTotal,
                )
                const payments = n(r.payments ?? (r as { paymentsTotal?: number }).paymentsTotal)
                const revenue = n(r.revenue) || invoiceRevenue + commission
                return (
                  <tr key={r.key || r.label}>
                    <td>{r.label}</td>
                    <td>{n(r.contracts)}</td>
                    <td>{money(contractValue)}</td>
                    <td>{n(r.indents)}</td>
                    <td>{money(commission)}</td>
                    <td>{n(r.invoices)}</td>
                    <td>{money(invoiceRevenue)}</td>
                    <td>{money(payments)}</td>
                    <td>{money(revenue)}</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="card">
          <div className="card-header"><h2 className="card-title">Top clients (by quoted value)</h2></div>
          <div className="card-body"><BarChart rows={topClients} format={money} /></div>
        </div>
        <div className="card">
          <div className="card-header"><h2 className="card-title">Top products (by quoted value)</h2></div>
          <div className="card-body"><BarChart rows={topProducts} format={money} color="#0891b2" /></div>
        </div>
      </div>

      <h2 className="panel-title">Indent commission</h2>
      <div className="table-wrap" style={{ marginBottom: 24 }}>
        <table>
          <thead>
            <tr><th>Indent #</th><th>Date</th><th>Contract</th><th>Clients</th><th>Qty (MT)</th><th>Rate/MT</th><th>Commission</th></tr>
          </thead>
          <tbody>
            {(ops.indents ?? []).length === 0 ? (
              <tr><td colSpan={7} className="empty-state">No indents with commission in this period</td></tr>
            ) : (
              (ops.indents ?? []).map((r, i) => (
                <tr key={r._id || i}>
                  <td>{r.indentNumber || '—'}</td>
                  <td>{formatDate(r.indentDate)}</td>
                  <td>{r.contractNumber || '—'}</td>
                  <td>{r.clients || '—'}</td>
                  <td>{n(r.qtyMt).toFixed(3)}</td>
                  <td>{r.commissionCurrency || 'USD'} {n(r.commissionPerMt).toFixed(2)}</td>
                  <td>{money(r.commissionUsd)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className="panel-title">Contracts signed</h2>
      <div className="table-wrap" style={{ marginBottom: 24 }}>
        <table>
          <thead><tr><th>Contract #</th><th>Date</th><th>Supplier</th><th>Value</th></tr></thead>
          <tbody>
            {(ops.contracts ?? []).length === 0 ? (
              <tr><td colSpan={4} className="empty-state">No contracts in this period</td></tr>
            ) : (
              (ops.contracts ?? []).map((r, i) => (
                <tr key={`${r.contractNumber}-${i}`}>
                  <td>{r.contractNumber || '—'}</td>
                  <td>{formatDate(r.contractDate)}</td>
                  <td>{r.supplierName || '—'}</td>
                  <td>{money(r.valueUsd)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className="panel-title">Invoices & payments</h2>
      <div className="table-wrap" style={{ marginBottom: 12 }}>
        <table>
          <thead><tr><th>Invoice #</th><th>Date</th><th>Client</th><th>Status</th><th>Amount</th></tr></thead>
          <tbody>
            {(ops.invoices ?? []).length === 0 ? (
              <tr><td colSpan={5} className="empty-state">No invoices in this period</td></tr>
            ) : (
              (ops.invoices ?? []).map((r, i) => (
                <tr key={`${r.invoiceNumber}-${i}`}>
                  <td>{r.invoiceNumber || '—'}</td>
                  <td>{formatDate(r.invoiceDate)}</td>
                  <td>{r.clientName || '—'}</td>
                  <td><span className="badge">{r.status || '—'}</span></td>
                  <td>{money(r.subtotalUsd)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="table-wrap" style={{ marginBottom: 24 }}>
        <table>
          <thead><tr><th>Payment date</th><th>Invoice #</th><th>Client</th><th>Method</th><th>Amount</th></tr></thead>
          <tbody>
            {(ops.payments ?? []).length === 0 ? (
              <tr><td colSpan={5} className="empty-state">No payments in this period</td></tr>
            ) : (
              (ops.payments ?? []).map((r, i) => (
                <tr key={i}>
                  <td>{formatDate(r.paymentDate)}</td>
                  <td>{r.invoiceNumber || '—'}</td>
                  <td>{r.clientName || '—'}</td>
                  <td>{r.method || '—'}</td>
                  <td>{money(r.amountUsd)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className="panel-title">Margin analysis by product</h2>
      <div className="table-wrap" style={{ marginBottom: 24 }}>
        <table>
          <thead><tr><th>Product</th><th>Quotations</th><th>Avg margin</th><th>Total revenue</th><th>Avg price</th></tr></thead>
          <tbody>
            {margins.length === 0 ? (
              <tr><td colSpan={5} className="empty-state">No data for this period</td></tr>
            ) : (
              margins.map((r, i) => (
                <tr key={r._id || i}>
                  <td>{r.productName || '—'}</td>
                  <td>{n(r.count)}</td>
                  <td>{r.avgMargin != null ? `${Number(r.avgMargin).toFixed(1)}%` : '—'}</td>
                  <td>{money(r.totalRevenue)}</td>
                  <td>${n(r.avgPrice).toFixed(2)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className="panel-title">Quotations by client</h2>
      <div className="table-wrap" style={{ marginBottom: 24 }}>
        <table>
          <thead><tr><th>Client</th><th>Count</th><th>Total quoted</th><th>Avg margin</th></tr></thead>
          <tbody>
            {clientQuotes.length === 0 ? (
              <tr><td colSpan={4} className="empty-state">No data for this period</td></tr>
            ) : (
              clientQuotes.map((r, i) => (
                <tr key={r._id || i}>
                  <td>{r.clientName || '—'}</td>
                  <td>{n(r.count)}</td>
                  <td>{money(r.totalQuoted)}</td>
                  <td>{r.avgMargin != null ? `${Number(r.avgMargin).toFixed(1)}%` : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className="panel-title">Supplier price comparison</h2>
      {supplierPrices.length === 0 ? (
        <p className="empty-state">No supplier product links yet.</p>
      ) : (
        supplierPrices.map((p, i) => (
          <div className="panel" key={`${p.productName}-${i}`}>
            <strong>{p.productName || '—'}</strong>{' '}
            <span style={{ color: 'var(--text-secondary)' }}>{p.category}</span>
            <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
              {(p.suppliers ?? []).length === 0 ? (
                <li>No supplier prices</li>
              ) : (
                (p.suppliers ?? []).map((sup, j) => (
                  <li key={j}>
                    {sup.supplierName}: {sup.currency || 'USD'} {sup.price != null ? sup.price : '—'}
                    {sup.moq ? ` (MOQ ${sup.moq})` : ''}
                  </li>
                ))
              )}
            </ul>
          </div>
        ))
      )}
    </>
  )
}
