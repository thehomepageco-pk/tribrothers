import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useUrlSearch } from '@/hooks/useUrlSearch'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/ui/Field'
import { formatDate, formatMoney, idOf, nameOf, toDateInput } from '@/lib/utils'
import {
  PAYMENT_METHODS,
  QUANTITY_UNITS,
  asList,
  badgeClassForStatus,
  errMsg,
  newKey,
  suggestNumber,
  todayInput,
  toNum,
  type CurrencyOption,
} from '@/lib/sales'

const INVOICE_STATUSES = ['Draft', 'Sent', 'Partially paid', 'Paid', 'Cancelled'] as const

type ClientOption = { _id: string; companyName?: string }
type ProductOption = { _id: string; name?: string; hsCode?: string }
type ContractOption = { _id: string; contractNumber?: string; priceCurrency?: string }
type ShipmentOption = {
  _id: string
  shipmentNumber?: string
  blNumber?: string
  vesselName?: string
  salesContract?: unknown
  indent?: {
    _id?: string
    indentNumber?: string
    sellingPricePerMt?: number
    sellingPriceCurrency?: string
  } | string
  lines?: Array<{ client?: unknown; product?: unknown; quantity?: number; quantityUnit?: string }>
}

type Payment = {
  _id: string
  amount?: number
  paymentDate?: string
  method?: string
  reference?: string
}

type InvoiceLine = {
  product?: unknown
  description?: string
  quantity?: number
  quantityUnit?: string
  unitPrice?: number
}

type Invoice = {
  _id: string
  client?: unknown
  invoiceNumber?: string
  invoiceDate?: string
  dueDate?: string
  currency?: string
  status?: string
  salesContract?: unknown
  shipment?: unknown
  notes?: string
  lines?: InvoiceLine[]
  payments?: Payment[]
  subtotal?: number
  paidAmount?: number
  balance?: number
}

type LineForm = {
  key: string
  productId: string
  description: string
  quantity: string
  quantityUnit: string
  unitPrice: string
}

type FormState = {
  clientId: string
  invoiceNumber: string
  invoiceDate: string
  dueDate: string
  currency: string
  status: string
  salesContractId: string
  shipmentId: string
  notes: string
}

type PaymentForm = {
  amount: string
  paymentDate: string
  method: string
  reference: string
}

function blankLine(): LineForm {
  return { key: newKey(), productId: '', description: '', quantity: '', quantityUnit: 'MT', unitPrice: '' }
}

function isBlankLine(l: LineForm) {
  return !l.productId && !l.description.trim() && l.quantity === '' && l.unitPrice === ''
}

function blankForm(invoiceNumber = ''): FormState {
  return {
    clientId: '',
    invoiceNumber,
    invoiceDate: todayInput(),
    dueDate: '',
    currency: 'USD',
    status: 'Draft',
    salesContractId: '',
    shipmentId: '',
    notes: '',
  }
}

export default function InvoicesPage() {
  useEffect(() => { document.title = 'Invoices & Payments' }, [])

  const { canEdit, canDelete } = useAuth()
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [clients, setClients] = useState<ClientOption[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const [contracts, setContracts] = useState<ContractOption[]>([])
  const [shipments, setShipments] = useState<ShipmentOption[]>([])
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([{ code: 'USD', name: 'US Dollar' }])
  const [loading, setLoading] = useState(true)
  const { search, setSearch, highlightId } = useUrlSearch()
  const [statusFilter, setStatusFilter] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Invoice | null>(null)
  const [form, setForm] = useState<FormState>(blankForm)
  const [lines, setLines] = useState<LineForm[]>([blankLine()])
  const [saving, setSaving] = useState(false)

  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null)
  const [payForm, setPayForm] = useState<PaymentForm>({
    amount: '',
    paymentDate: todayInput(),
    method: 'TT',
    reference: '',
  })
  const [paySaving, setPaySaving] = useState(false)
  const paramsHandled = useRef(false)

  const loadInvoices = useCallback(async () => {
    try {
      const list = asList<Invoice>(await api<unknown>('/api/invoices'))
      setInvoices(list)
      return list
    } catch (e) {
      toast(errMsg(e, 'Failed to load invoices'), 'error')
      return []
    }
  }, [toast])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [cl, pr, co, sh, cu] = await Promise.allSettled([
        api<unknown>('/api/clients'),
        api<unknown>('/api/products'),
        api<unknown>('/api/sales-contracts'),
        api<unknown>('/api/shipments'),
        api<unknown>('/api/currencies'),
      ])
      if (cancelled) return
      if (cl.status === 'fulfilled') {
        setClients(
          asList<ClientOption>(cl.value).sort((a, b) => (a.companyName || '').localeCompare(b.companyName || '')),
        )
      }
      if (pr.status === 'fulfilled') {
        setProducts(asList<ProductOption>(pr.value).sort((a, b) => (a.name || '').localeCompare(b.name || '')))
      }
      if (co.status === 'fulfilled') setContracts(asList<ContractOption>(co.value))
      if (sh.status === 'fulfilled') setShipments(asList<ShipmentOption>(sh.value))
      if (cu.status === 'fulfilled') {
        const list = asList<CurrencyOption>(cu.value)
        if (list.length) setCurrencies(list)
      }
      await loadInvoices()
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [loadInvoices])

  const shipmentById = useMemo(() => new Map(shipments.map((s) => [s._id, s])), [shipments])

  const nextNumber = useCallback(
    () =>
      suggestNumber(
        'INV',
        invoices.map((i) => i.invoiceNumber),
      ),
    [invoices],
  )

  /** Prefill contract / client / notes / lines from a shipment — only touching empty fields. */
  const prefillFromShipment = useCallback(
    (shipmentId: string, base: FormState, baseLines: LineForm[]) => {
      const s = shipmentById.get(shipmentId)
      const next: FormState = { ...base, shipmentId }
      if (!s) return { form: next, lines: baseLines }
      const contractId = idOf(s.salesContract)
      if (contractId && !next.salesContractId) {
        next.salesContractId = contractId
        const c = contracts.find((x) => x._id === contractId)
        if (c?.priceCurrency && !base.clientId && base.currency === 'USD') next.currency = c.priceCurrency
      }
      const indent = typeof s.indent === 'object' && s.indent ? s.indent : null
      if (indent?.sellingPriceCurrency && next.currency === 'USD') {
        next.currency = indent.sellingPriceCurrency
      }
      if (!next.notes.trim()) {
        next.notes = `Shipment ${s.shipmentNumber || ''}${s.vesselName ? ` — ${s.vesselName}` : ''}`.trim()
      }
      const firstClient = (s.lines || []).map((l) => idOf(l.client)).find(Boolean)
      if (firstClient && !next.clientId) next.clientId = firstClient
      const unitPriceDefault =
        indent?.sellingPricePerMt != null && Number(indent.sellingPricePerMt) > 0
          ? String(indent.sellingPricePerMt)
          : ''
      let nextLines = baseLines
      if (baseLines.every(isBlankLine)) {
        const fromShipment = (s.lines || [])
          .filter((l) => toNum(l.quantity) > 0)
          .map<LineForm>((l) => ({
            key: newKey(),
            productId: idOf(l.product),
            description: '',
            quantity: String(l.quantity),
            quantityUnit: l.quantityUnit || 'MT',
            unitPrice: unitPriceDefault,
          }))
        if (fromShipment.length) nextLines = fromShipment
      }
      return { form: next, lines: nextLines }
    },
    [shipmentById, contracts],
  )

  const openNew = useCallback(
    (opts?: { shipmentId?: string; clientId?: string }) => {
      setEditing(null)
      let f = blankForm(nextNumber())
      let l: LineForm[] = [blankLine()]
      if (opts?.clientId) f = { ...f, clientId: opts.clientId }
      if (opts?.shipmentId) {
        const r = prefillFromShipment(opts.shipmentId, f, l)
        f = r.form
        l = r.lines
      }
      setForm(f)
      setLines(l)
      setModalOpen(true)
    },
    [nextNumber, prefillFromShipment],
  )

  const openEdit = (inv: Invoice) => {
    setEditing(inv)
    setForm({
      clientId: idOf(inv.client),
      invoiceNumber: inv.invoiceNumber || '',
      invoiceDate: toDateInput(inv.invoiceDate) || todayInput(),
      dueDate: toDateInput(inv.dueDate),
      currency: inv.currency || 'USD',
      status: inv.status || 'Draft',
      salesContractId: idOf(inv.salesContract),
      shipmentId: idOf(inv.shipment),
      notes: inv.notes || '',
    })
    const mapped = (inv.lines || []).map<LineForm>((l) => ({
      key: newKey(),
      productId: idOf(l.product),
      description: l.description || '',
      quantity: l.quantity != null ? String(l.quantity) : '',
      quantityUnit: l.quantityUnit || 'MT',
      unitPrice: l.unitPrice != null ? String(l.unitPrice) : '',
    }))
    setLines(mapped.length ? mapped : [blankLine()])
    setModalOpen(true)
  }

  // ?new=1, ?shipment=<id>, ?client=<id>
  useEffect(() => {
    if (loading || paramsHandled.current) return
    const shipmentParam = searchParams.get('shipment')
    const clientParam = searchParams.get('client')
    const wantsNew = searchParams.get('new') === '1'
    if (!shipmentParam && !clientParam && !wantsNew) return
    paramsHandled.current = true
    if (canEdit) openNew({ shipmentId: shipmentParam || undefined, clientId: clientParam || undefined })
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    next.delete('shipment')
    next.delete('client')
    setSearchParams(next, { replace: true })
  }, [loading, searchParams, setSearchParams, canEdit, openNew])

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
    setEditing(null)
  }

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const updateLine = (key: string, patch: Partial<LineForm>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const onShipmentChange = (shipmentId: string) => {
    if (!shipmentId) {
      setField('shipmentId', '')
      return
    }
    const r = prefillFromShipment(shipmentId, form, lines)
    setForm(r.form)
    setLines(r.lines)
  }

  const formSubtotal = useMemo(
    () => lines.reduce((s, l) => s + toNum(l.quantity) * toNum(l.unitPrice), 0),
    [lines],
  )

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    if (!form.clientId) return toast('Select a client.', 'error')
    if (!form.invoiceNumber.trim()) return toast('Enter an invoice number.', 'error')
    if (!form.invoiceDate) return toast('Select an invoice date.', 'error')
    if (!form.currency) return toast('Select a currency.', 'error')

    const used = lines.filter((l) => !isBlankLine(l))
    if (!used.length) return toast('Add at least one line with quantity and unit price.', 'error')
    if (used.some((l) => !(toNum(l.quantity) > 0) || l.unitPrice === '' || toNum(l.unitPrice) < 0)) {
      return toast('Each line needs a quantity greater than 0 and a unit price.', 'error')
    }

    const payload = {
      client: form.clientId,
      invoiceNumber: form.invoiceNumber.trim(),
      invoiceDate: form.invoiceDate,
      dueDate: form.dueDate || undefined,
      currency: form.currency,
      status: form.status,
      salesContract: form.salesContractId || undefined,
      shipment: form.shipmentId || undefined,
      notes: form.notes.trim(),
      lines: used.map((l) => ({
        product: l.productId || undefined,
        description: l.description.trim(),
        quantity: Number(l.quantity),
        quantityUnit: l.quantityUnit,
        unitPrice: Number(l.unitPrice),
      })),
    }

    setSaving(true)
    try {
      await api(editing ? `/api/invoices/${editing._id}` : '/api/invoices', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(
          editing
            ? { ...payload, dueDate: form.dueDate, salesContract: form.salesContractId, shipment: form.shipmentId }
            : payload,
        ),
      })
      toast(editing ? 'Invoice updated' : 'Invoice saved', 'success')
      setModalOpen(false)
      setEditing(null)
      await loadInvoices()
    } catch (err) {
      toast(errMsg(err, 'Save failed'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (inv: Invoice) => {
    if (!window.confirm(`Delete invoice ${inv.invoiceNumber || ''}? Its payments will be deleted too.`)) return
    try {
      await api(`/api/invoices/${inv._id}`, { method: 'DELETE' })
      toast('Invoice deleted', 'success')
      await loadInvoices()
    } catch (err) {
      toast(errMsg(err, 'Delete failed'), 'error')
    }
  }

  const printInvoice = (id: string) => {
    window.open(`/api/invoices/${id}/print`, '_blank')
  }

  const openPayment = (inv: Invoice) => {
    setPayInvoice(inv)
    setPayForm({
      amount: inv.balance && inv.balance > 0 ? String(Math.round(inv.balance * 100) / 100) : '',
      paymentDate: todayInput(),
      method: 'TT',
      reference: '',
    })
  }

  const closePayment = () => {
    if (paySaving) return
    setPayInvoice(null)
  }

  const handlePaymentSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!payInvoice || paySaving) return
    if (!(toNum(payForm.amount) > 0)) return toast('Payment amount must be greater than 0.', 'error')
    if (!payForm.paymentDate) return toast('Select a payment date.', 'error')
    setPaySaving(true)
    try {
      const res = await api<{ invoice?: Invoice }>(`/api/invoices/${payInvoice._id}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount: Number(payForm.amount),
          paymentDate: payForm.paymentDate,
          method: payForm.method,
          reference: payForm.reference.trim() || undefined,
        }),
      })
      toast('Payment recorded', 'success')
      const list = await loadInvoices()
      const updated = res?.invoice || list.find((i) => i._id === payInvoice._id)
      // Keep the dialog open on the refreshed invoice so the user sees the new balance.
      if (updated && (updated.balance ?? 0) > 0.0001 && updated.status !== 'Cancelled') {
        openPayment(updated)
      } else {
        setPayInvoice(null)
      }
    } catch (err) {
      toast(errMsg(err, 'Failed to record payment'), 'error')
    } finally {
      setPaySaving(false)
    }
  }

  const deletePayment = async (payment: Payment) => {
    if (!payInvoice) return
    if (!window.confirm('Delete this payment?')) return
    try {
      await api(`/api/payments/${payment._id}`, { method: 'DELETE' })
      toast('Payment deleted', 'success')
      const list = await loadInvoices()
      const updated = list.find((i) => i._id === payInvoice._id)
      if (updated) openPayment(updated)
    } catch (err) {
      toast(errMsg(err, 'Delete failed'), 'error')
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return invoices.filter((i) => {
      if (statusFilter && i.status !== statusFilter) return false
      if (!q) return true
      const hay = [
        i.invoiceNumber,
        nameOf(i.client, ['companyName']),
        nameOf(i.salesContract, ['contractNumber']),
        nameOf(i.shipment, ['shipmentNumber']),
        i.status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [invoices, search, statusFilter])

  const totalsByCurrency = useMemo(() => {
    const map = new Map<string, { total: number; paid: number; balance: number }>()
    for (const i of invoices) {
      if (i.status === 'Cancelled' || i.status === 'Draft') continue
      const cur = i.currency || 'USD'
      const row = map.get(cur) || { total: 0, paid: 0, balance: 0 }
      row.total += toNum(i.subtotal)
      row.paid += toNum(i.paidAmount)
      row.balance += toNum(i.balance)
      map.set(cur, row)
    }
    return Array.from(map.entries())
  }, [invoices])

  const currencyOptions = currencies.some((c) => c.code === form.currency)
    ? currencies
    : [...currencies, { code: form.currency }]

  return (
    <>
      <header className="page-header">
        <h1>Invoices &amp; payments</h1>
        <div className="page-actions">
          {canEdit && (
            <button type="button" className="btn" onClick={() => openNew()}>
              New invoice
            </button>
          )}
        </div>
      </header>

      {totalsByCurrency.length > 0 && (
        <div className="kpi-row">
          {totalsByCurrency.map(([cur, t]) => (
            <div key={cur} className="kpi-card">
              <div className="kpi-title">Outstanding ({cur})</div>
              <div className="kpi-number">{formatMoney(t.balance, cur)}</div>
              <div className="kpi-sub">
                Invoiced {formatMoney(t.total, cur)} · Paid {formatMoney(t.paid, cur)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="products-toolbar">
        <input
          type="search"
          placeholder="Invoice #, client, contract, shipment…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
          style={{
            height: 38,
            borderRadius: 10,
            border: '1px solid var(--border-default)',
            background: 'var(--bg-elevated)',
            padding: '0 12px',
          }}
        >
          <option value="">All statuses</option>
          {INVOICE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="loading-block">Loading invoices…</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Client</th>
                <th>Date</th>
                <th>Due</th>
                <th>Status</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <div className="empty-state">
                      {invoices.length ? 'No invoices match your filters.' : 'No invoices yet.'}
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((inv) => {
                  const cur = inv.currency || 'USD'
                  const canPay = canEdit && inv.status !== 'Cancelled' && toNum(inv.balance) > 0.0001
                  return (
                    <tr key={inv._id}>
                      <td>
                        <strong>{inv.invoiceNumber || '—'}</strong>
                        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                          {[
                            inv.salesContract ? nameOf(inv.salesContract, ['contractNumber']) : '',
                            inv.shipment ? nameOf(inv.shipment, ['shipmentNumber']) : '',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </td>
                      <td>{nameOf(inv.client, ['companyName'])}</td>
                      <td>{formatDate(inv.invoiceDate)}</td>
                      <td>{formatDate(inv.dueDate)}</td>
                      <td>
                        <span className={badgeClassForStatus(inv.status)}>{inv.status || 'Draft'}</span>
                      </td>
                      <td>{formatMoney(inv.subtotal, cur)}</td>
                      <td>{formatMoney(inv.paidAmount, cur)}</td>
                      <td>{formatMoney(inv.balance, cur)}</td>
                      <td>
                        <div className="row-actions">
                          <button type="button" className="action-btn" onClick={() => printInvoice(inv._id)}>
                            Print
                          </button>
                          {canPay && (
                            <button type="button" className="action-btn" onClick={() => openPayment(inv)}>
                              Payment
                            </button>
                          )}
                          {!canPay && (inv.payments || []).length > 0 && (
                            <button type="button" className="action-btn" onClick={() => openPayment(inv)}>
                              Payments
                            </button>
                          )}
                          {canEdit && (
                            <button type="button" className="action-btn" onClick={() => openEdit(inv)}>
                              Edit
                            </button>
                          )}
                          {canDelete && (
                            <button type="button" className="action-btn delete-btn" onClick={() => handleDelete(inv)}>
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <Modal
          large
          title={editing ? 'Edit invoice' : 'Create invoice'}
          onClose={closeModal}
          footer={
            <>
              <button type="button" className="action-btn" onClick={closeModal} disabled={saving}>
                Cancel
              </button>
              <button type="submit" form="invoice-form" className="btn" disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Save invoice'}
              </button>
            </>
          }
        >
          <form id="invoice-form" onSubmit={handleSubmit}>
            <div className="form-grid">
              <Field label="Client" htmlFor="inv-client" required>
                <select
                  id="inv-client"
                  value={form.clientId}
                  onChange={(e) => setField('clientId', e.target.value)}
                  required
                >
                  <option value="">Select client</option>
                  {clients.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.companyName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Invoice number" htmlFor="inv-number" required>
                <input
                  id="inv-number"
                  value={form.invoiceNumber}
                  onChange={(e) => setField('invoiceNumber', e.target.value)}
                  required
                />
              </Field>
              <Field label="Invoice date" htmlFor="inv-date" required>
                <input
                  id="inv-date"
                  type="date"
                  value={form.invoiceDate}
                  onChange={(e) => setField('invoiceDate', e.target.value)}
                  required
                />
              </Field>
              <Field label="Due date" htmlFor="inv-due">
                <input id="inv-due" type="date" value={form.dueDate} onChange={(e) => setField('dueDate', e.target.value)} />
              </Field>
              <Field label="Currency" htmlFor="inv-cur" required>
                <select
                  id="inv-cur"
                  value={form.currency}
                  onChange={(e) => setField('currency', e.target.value)}
                  required
                >
                  {currencyOptions.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                      {c.name ? ` — ${c.name}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Status" htmlFor="inv-status">
                <select id="inv-status" value={form.status} onChange={(e) => setField('status', e.target.value)}>
                  {INVOICE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Sales contract" htmlFor="inv-contract">
                <select
                  id="inv-contract"
                  value={form.salesContractId}
                  onChange={(e) => setField('salesContractId', e.target.value)}
                >
                  <option value="">Select contract (optional)</option>
                  {contracts.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.contractNumber}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Shipment" htmlFor="inv-shipment">
                <select id="inv-shipment" value={form.shipmentId} onChange={(e) => onShipmentChange(e.target.value)}>
                  <option value="">Select shipment (optional)</option>
                  {shipments.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.shipmentNumber}
                      {s.blNumber ? ` — B/L ${s.blNumber}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <h3 className="panel-title" style={{ marginTop: 20 }}>
              Lines
            </h3>
            <div className="line-items">
              {lines.map((l, idx) => (
                <div key={l.key} className="panel" style={{ marginBottom: 0 }}>
                  <div className="line-item">
                    <Field label={`Product (line ${idx + 1})`} htmlFor={`inv-line-prod-${l.key}`}>
                      <select
                        id={`inv-line-prod-${l.key}`}
                        value={l.productId}
                        onChange={(e) => updateLine(l.key, { productId: e.target.value })}
                      >
                        <option value="">— none —</option>
                        {products.map((p) => (
                          <option key={p._id} value={p._id}>
                            {p.name}
                            {p.hsCode ? ` (${p.hsCode})` : ''}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Quantity" htmlFor={`inv-line-qty-${l.key}`}>
                      <input
                        id={`inv-line-qty-${l.key}`}
                        type="number"
                        min="0"
                        step="any"
                        value={l.quantity}
                        onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                      />
                    </Field>
                    <Field label="Unit" htmlFor={`inv-line-unit-${l.key}`}>
                      <select
                        id={`inv-line-unit-${l.key}`}
                        value={l.quantityUnit}
                        onChange={(e) => updateLine(l.key, { quantityUnit: e.target.value })}
                      >
                        {QUANTITY_UNITS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={`Unit price (${form.currency})`} htmlFor={`inv-line-price-${l.key}`}>
                      <input
                        id={`inv-line-price-${l.key}`}
                        type="number"
                        min="0"
                        step="any"
                        value={l.unitPrice}
                        onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })}
                      />
                    </Field>
                    <button
                      type="button"
                      className="action-btn"
                      onClick={() =>
                        setLines((p) => (p.length <= 1 ? [blankLine()] : p.filter((x) => x.key !== l.key)))
                      }
                      aria-label={`Remove line ${idx + 1}`}
                    >
                      Remove
                    </button>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <Field label="Description" htmlFor={`inv-line-desc-${l.key}`}>
                      <input
                        id={`inv-line-desc-${l.key}`}
                        value={l.description}
                        onChange={(e) => updateLine(l.key, { description: e.target.value })}
                        placeholder="Optional description"
                      />
                    </Field>
                    <div style={{ textAlign: 'right', marginTop: 6, fontSize: 12.5, color: 'var(--text-muted)' }}>
                      Line total: {formatMoney(toNum(l.quantity) * toNum(l.unitPrice), form.currency)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <button type="button" className="action-btn" onClick={() => setLines((p) => [...p, blankLine()])}>
                + Add line
              </button>
              <strong>Subtotal: {formatMoney(formSubtotal, form.currency)}</strong>
            </div>

            <div className="form-grid" style={{ marginTop: 18 }}>
              <Field label="Notes" htmlFor="inv-notes" className="span-2">
                <textarea id="inv-notes" rows={3} value={form.notes} onChange={(e) => setField('notes', e.target.value)} />
              </Field>
            </div>
          </form>
        </Modal>
      )}

      {payInvoice && (
        <Modal
          title={`Payments — ${payInvoice.invoiceNumber || ''}`}
          onClose={closePayment}
          footer={
            <>
              <button type="button" className="action-btn" onClick={closePayment} disabled={paySaving}>
                Close
              </button>
              {canEdit && payInvoice.status !== 'Cancelled' && (
                <button type="submit" form="payment-form" className="btn" disabled={paySaving}>
                  {paySaving ? 'Saving…' : 'Record payment'}
                </button>
              )}
            </>
          }
        >
          {(() => {
            const cur = payInvoice.currency || 'USD'
            return (
              <>
                <div className="kpi-row" style={{ marginBottom: 14 }}>
                  <div className="kpi-card">
                    <div className="kpi-title">Total</div>
                    <div className="kpi-number" style={{ fontSize: '1.25rem' }}>
                      {formatMoney(payInvoice.subtotal, cur)}
                    </div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-title">Paid</div>
                    <div className="kpi-number" style={{ fontSize: '1.25rem' }}>
                      {formatMoney(payInvoice.paidAmount, cur)}
                    </div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-title">Balance</div>
                    <div className="kpi-number" style={{ fontSize: '1.25rem' }}>
                      {formatMoney(payInvoice.balance, cur)}
                    </div>
                  </div>
                </div>

                {(payInvoice.payments || []).length > 0 && (
                  <div className="table-wrap" style={{ marginBottom: 16 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Method</th>
                          <th>Reference</th>
                          <th>Amount</th>
                          {canDelete && <th />}
                        </tr>
                      </thead>
                      <tbody>
                        {(payInvoice.payments || []).map((p) => (
                          <tr key={p._id}>
                            <td>{formatDate(p.paymentDate)}</td>
                            <td>{p.method || '—'}</td>
                            <td>{p.reference || '—'}</td>
                            <td>{formatMoney(p.amount, cur)}</td>
                            {canDelete && (
                              <td>
                                <button
                                  type="button"
                                  className="action-btn delete-btn"
                                  onClick={() => deletePayment(p)}
                                >
                                  Delete
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {canEdit && payInvoice.status !== 'Cancelled' && (
                  <form id="payment-form" onSubmit={handlePaymentSubmit}>
                    <div className="form-grid">
                      <Field label={`Amount (${cur})`} htmlFor="pay-amount" required>
                        <input
                          id="pay-amount"
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={payForm.amount}
                          onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))}
                          required
                        />
                      </Field>
                      <Field label="Payment date" htmlFor="pay-date" required>
                        <input
                          id="pay-date"
                          type="date"
                          value={payForm.paymentDate}
                          onChange={(e) => setPayForm((f) => ({ ...f, paymentDate: e.target.value }))}
                          required
                        />
                      </Field>
                      <Field label="Method" htmlFor="pay-method">
                        <select
                          id="pay-method"
                          value={payForm.method}
                          onChange={(e) => setPayForm((f) => ({ ...f, method: e.target.value }))}
                        >
                          {PAYMENT_METHODS.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Reference" htmlFor="pay-ref">
                        <input
                          id="pay-ref"
                          value={payForm.reference}
                          onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))}
                          placeholder="Optional"
                        />
                      </Field>
                    </div>
                  </form>
                )}
              </>
            )
          })()}
        </Modal>
      )}
    </>
  )
}
