import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { api } from '@/api/client'
import { RowActionsMenu } from '@/components/RowActionsMenu'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/ui/Field'
import { formatDate, formatMoney, nameOf, toDateInput } from '@/lib/utils'
import {
  PAYMENT_METHODS,
  asList,
  badgeClassForStatus,
  errMsg,
  fmtQty,
  todayInput,
  toNum,
} from '@/lib/sales'

const COMMISSION_STATUSES = ['Unpaid', 'Partially paid', 'Paid', 'Cancelled'] as const

type CommissionPayment = {
  _id: string
  amount?: number
  paymentDate?: string
  method?: string
  reference?: string
  notes?: string
  currency?: string
}

type Commission = {
  _id: string
  commissionNumber?: string
  type?: 'client' | 'supplier' | string
  status?: string
  partyLabel?: string
  description?: string
  quantityMt?: number
  ratePerMt?: number
  amount?: number
  currency?: string
  paidAmount?: number
  balance?: number
  dueDate?: string
  earnedDate?: string
  notes?: string
  salesContract?: unknown
  indent?: unknown
  client?: unknown
  supplier?: unknown
  payments?: CommissionPayment[]
}

type Summary = {
  currencies?: Array<{
    currency: string
    total: number
    paid: number
    balance: number
    count: number
    unpaid: number
    partial: number
    paidCount: number
  }>
  totalRecords?: number
}

export default function CommissionsPage() {
  useEffect(() => { document.title = 'Commissions' }, [])

  const { canEdit, canDelete } = useAuth()
  const { toast } = useToast()

  const [items, setItems] = useState<Commission[]>([])
  const [summary, setSummary] = useState<Summary>({})
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const debouncedSearch = useDebouncedValue(search, 300)

  // Edit dialog
  const [editing, setEditing] = useState<Commission | null>(null)
  const [editForm, setEditForm] = useState({ dueDate: '', notes: '', cancelled: false })
  const [editSaving, setEditSaving] = useState(false)

  // Payments dialog
  const [payId, setPayId] = useState<string | null>(null)
  const [payForm, setPayForm] = useState({
    amount: '',
    paymentDate: todayInput(),
    method: 'TT',
    reference: '',
    notes: '',
  })
  const [paySaving, setPaySaving] = useState(false)

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await api<Summary>('/api/commissions/summary'))
    } catch {
      setSummary({})
    }
  }, [])

  const loadItems = useCallback(async () => {
    const params = new URLSearchParams()
    if (typeFilter) params.set('type', typeFilter)
    if (statusFilter) params.set('status', statusFilter)
    if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim())
    const qs = params.toString()
    try {
      setItems(asList<Commission>(await api<unknown>(`/api/commissions${qs ? `?${qs}` : ''}`)))
    } catch (e) {
      toast(errMsg(e, 'Failed to load commissions'), 'error')
    }
  }, [typeFilter, statusFilter, debouncedSearch, toast])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await loadItems()
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [loadItems])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  const refresh = useCallback(async () => {
    await Promise.all([loadItems(), loadSummary()])
  }, [loadItems, loadSummary])

  const handleSync = async () => {
    if (syncing) return
    setSyncing(true)
    try {
      const res = await api<{ message?: string }>('/api/commissions/sync', { method: 'POST' })
      toast(res?.message || 'Commissions synced', 'success')
      await refresh()
    } catch (e) {
      toast(errMsg(e, 'Sync failed'), 'error')
    } finally {
      setSyncing(false)
    }
  }

  const openEdit = (c: Commission) => {
    setEditing(c)
    setEditForm({
      dueDate: toDateInput(c.dueDate),
      notes: c.notes || '',
      cancelled: c.status === 'Cancelled',
    })
  }

  const handleEditSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!editing || editSaving) return
    setEditSaving(true)
    try {
      await api(`/api/commissions/${editing._id}`, {
        method: 'PUT',
        body: JSON.stringify({
          dueDate: editForm.dueDate,
          notes: editForm.notes.trim(),
          // Server keeps "Cancelled" as a manual state; any other value re-derives status from payments.
          status: editForm.cancelled ? 'Cancelled' : editing.status === 'Cancelled' ? 'Unpaid' : editing.status || 'Unpaid',
        }),
      })
      toast('Commission updated', 'success')
      setEditing(null)
      await refresh()
    } catch (err) {
      toast(errMsg(err, 'Update failed'), 'error')
    } finally {
      setEditSaving(false)
    }
  }

  const payCommission = useMemo(() => items.find((c) => c._id === payId) || null, [items, payId])

  const openPayments = (c: Commission) => {
    setPayId(c._id)
    setPayForm({
      amount: toNum(c.balance) > 0 ? String(Math.round(toNum(c.balance) * 100) / 100) : '',
      paymentDate: todayInput(),
      method: 'TT',
      reference: '',
      notes: '',
    })
  }

  const closePayments = () => {
    if (paySaving) return
    setPayId(null)
  }

  const handlePaymentSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!payCommission || paySaving) return
    if (!(toNum(payForm.amount) > 0)) return toast('Payment amount must be greater than 0.', 'error')
    if (!payForm.paymentDate) return toast('Select a payment date.', 'error')
    setPaySaving(true)
    try {
      const res = await api<{ commission?: Commission }>(`/api/commissions/${payCommission._id}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount: Number(payForm.amount),
          paymentDate: payForm.paymentDate,
          method: payForm.method,
          reference: payForm.reference.trim() || undefined,
          notes: payForm.notes.trim() || undefined,
        }),
      })
      toast('Payment recorded', 'success')
      await refresh()
      const bal = toNum(res?.commission?.balance)
      setPayForm({
        amount: bal > 0 ? String(Math.round(bal * 100) / 100) : '',
        paymentDate: todayInput(),
        method: payForm.method,
        reference: '',
        notes: '',
      })
    } catch (err) {
      toast(errMsg(err, 'Failed to record payment'), 'error')
    } finally {
      setPaySaving(false)
    }
  }

  const deletePayment = async (payment: CommissionPayment) => {
    if (!window.confirm('Delete this payment?')) return
    try {
      await api(`/api/commission-payments/${payment._id}`, { method: 'DELETE' })
      toast('Payment deleted', 'success')
      await refresh()
    } catch (err) {
      toast(errMsg(err, 'Delete failed'), 'error')
    }
  }

  const sourceLabel = (c: Commission) => {
    const parts = [
      c.salesContract ? `SC ${nameOf(c.salesContract, ['contractNumber'])}` : '',
      c.indent ? `Indent ${nameOf(c.indent, ['indentNumber'])}` : '',
    ].filter(Boolean)
    return parts.join(' · ') || '—'
  }

  const partyLabel = (c: Commission) =>
    c.partyLabel || nameOf(c.client, ['companyName']) || nameOf(c.supplier, ['companyName'])

  /** Both supplier commission and client margin are paid TO Tri Brothers (received from party). */
  const directionLabel = (_c: Commission) => 'Receive'

  const currencies = summary.currencies || []
  const unpaidCount = currencies.reduce((s, c) => s + (c.unpaid || 0), 0)
  const partialCount = currencies.reduce((s, c) => s + (c.partial || 0), 0)

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Finance</p>
          <h1>Commissions</h1>
        </div>
      </header>

      <div className="kpi-row">
        <div className="kpi-card">
          <div className="kpi-title">Total outstanding</div>
          {currencies.length ? (
            currencies.map((c) => (
              <div key={c.currency} className="kpi-number" style={{ fontSize: '1.2rem', marginTop: 6 }}>
                {formatMoney(c.balance, c.currency)}
              </div>
            ))
          ) : (
            <div className="kpi-number">—</div>
          )}
        </div>
        <div className="kpi-card">
          <div className="kpi-title">Total received</div>
          {currencies.length ? (
            currencies.map((c) => (
              <div key={c.currency} className="kpi-number" style={{ fontSize: '1.2rem', marginTop: 6 }}>
                {formatMoney(c.paid, c.currency)}
              </div>
            ))
          ) : (
            <div className="kpi-number">—</div>
          )}
        </div>
        <div className="kpi-card">
          <div className="kpi-title">Unpaid records</div>
          <div className="kpi-number">{unpaidCount}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-title">Partially paid</div>
          <div className="kpi-number">{partialCount}</div>
          <div className="kpi-sub">{summary.totalRecords ?? 0} active records</div>
        </div>
      </div>

      <div className="products-toolbar list-toolbar">
        <div className="toolbar-row">
          <div className="toolbar-group toolbar-search">
            <label htmlFor="comSearchInput">Search</label>
            <input
              id="comSearchInput"
              type="search"
              placeholder="Commission #, party, contract, indent…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="toolbar-group toolbar-compact">
            <label htmlFor="comTypeFilter">Source</label>
            <select
              id="comTypeFilter"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label="Filter by commission source"
            >
              <option value="">All sources</option>
              <option value="client">From client</option>
              <option value="supplier">From supplier</option>
            </select>
          </div>
          <div className="toolbar-group toolbar-compact">
            <label htmlFor="comStatusFilter">Status</label>
            <select
              id="comStatusFilter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {COMMISSION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          {canEdit ? (
            <div className="toolbar-actions">
              <button type="button" className="btn btn-sm" onClick={handleSync} disabled={syncing}>
                {syncing ? 'Syncing…' : 'Sync'}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="loading-block">Loading commissions…</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Type</th>
                <th>From</th>
                <th>Party</th>
                <th>Qty (MT)</th>
                <th>Rate / MT</th>
                <th>Amount</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Due</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={12}>
                    <div className="empty-state">
                      No commissions found.
                      {canEdit ? ' Use Sync to generate them from contracts & indents.' : ''}
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((c) => {
                  const cur = c.currency || 'USD'
                  const dir = directionLabel(c)
                  return (
                    <tr key={c._id}>
                      <td>
                        <strong>{c.commissionNumber || '—'}</strong>
                      </td>
                      <td>
                        <span className="badge badge-success">{dir}</span>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {c.type === 'supplier' ? 'From supplier' : 'From client'}
                        </div>
                      </td>
                      <td>{sourceLabel(c)}</td>
                      <td>{partyLabel(c)}</td>
                      <td>{fmtQty(c.quantityMt)}</td>
                      <td>{formatMoney(c.ratePerMt, cur)}</td>
                      <td>{formatMoney(c.amount, cur)}</td>
                      <td>{formatMoney(c.paidAmount, cur)}</td>
                      <td>{formatMoney(c.balance, cur)}</td>
                      <td>{formatDate(c.dueDate)}</td>
                      <td>
                        <span className={badgeClassForStatus(c.status)}>{c.status || 'Unpaid'}</span>
                      </td>
                      <td className="table-actions-cell">
                        <RowActionsMenu
                          items={[
                            {
                              label:
                                canEdit && c.status !== 'Cancelled'
                                  ? 'Record receipt'
                                  : 'View receipts',
                              onClick: () => openPayments(c),
                            },
                            { label: 'Edit', hidden: !canEdit, onClick: () => openEdit(c) },
                          ]}
                        />
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal
          title={`Edit commission — ${editing.commissionNumber || ''}`}
          onClose={() => !editSaving && setEditing(null)}
          footer={
            <>
              <button type="button" className="action-btn" onClick={() => setEditing(null)} disabled={editSaving}>
                Cancel
              </button>
              <button type="submit" form="commission-edit-form" className="btn" disabled={editSaving}>
                {editSaving ? 'Saving…' : 'Save changes'}
              </button>
            </>
          }
        >
          <form id="commission-edit-form" onSubmit={handleEditSubmit}>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 14 }}>
              {partyLabel(editing)} · {formatMoney(editing.amount, editing.currency || 'USD')} · {sourceLabel(editing)}
            </p>
            <div className="form-grid">
              <Field label="Due date" htmlFor="com-due">
                <input
                  id="com-due"
                  type="date"
                  value={editForm.dueDate}
                  onChange={(e) => setEditForm((f) => ({ ...f, dueDate: e.target.value }))}
                />
              </Field>
              <Field
                label="Status"
                htmlFor="com-status"
                hint="Status follows recorded payments. Mark as cancelled to exclude this commission."
              >
                <select
                  id="com-status"
                  value={editForm.cancelled ? 'Cancelled' : 'auto'}
                  onChange={(e) => setEditForm((f) => ({ ...f, cancelled: e.target.value === 'Cancelled' }))}
                >
                  <option value="auto">Active (from payments)</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </Field>
              <Field label="Notes" htmlFor="com-notes" className="span-2">
                <textarea
                  id="com-notes"
                  rows={3}
                  value={editForm.notes}
                  onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </Field>
            </div>
          </form>
        </Modal>
      )}

      {payCommission && (
        <Modal
          title={`Receipts — ${payCommission.commissionNumber || ''}`}
          onClose={closePayments}
          footer={
            <>
              <button type="button" className="action-btn" onClick={closePayments} disabled={paySaving}>
                Close
              </button>
              {canEdit && payCommission.status !== 'Cancelled' && (
                <button type="submit" form="commission-pay-form" className="btn" disabled={paySaving}>
                  {paySaving ? 'Saving…' : 'Record receipt'}
                </button>
              )}
            </>
          }
        >
          {(() => {
            const cur = payCommission.currency || 'USD'
            return (
              <>
                <p style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>
                  {partyLabel(payCommission)} · {sourceLabel(payCommission)}{' '}
                  <span className={badgeClassForStatus(payCommission.status)}>{payCommission.status}</span>
                </p>
                <div className="kpi-row" style={{ marginBottom: 14 }}>
                  <div className="kpi-card">
                    <div className="kpi-title">Amount</div>
                    <div className="kpi-number" style={{ fontSize: '1.25rem' }}>
                      {formatMoney(payCommission.amount, cur)}
                    </div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-title">Received</div>
                    <div className="kpi-number" style={{ fontSize: '1.25rem' }}>
                      {formatMoney(payCommission.paidAmount, cur)}
                    </div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-title">Balance</div>
                    <div className="kpi-number" style={{ fontSize: '1.25rem' }}>
                      {formatMoney(payCommission.balance, cur)}
                    </div>
                  </div>
                </div>

                {(payCommission.payments || []).length > 0 ? (
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
                        {(payCommission.payments || []).map((p) => (
                          <tr key={p._id}>
                            <td>{formatDate(p.paymentDate)}</td>
                            <td>{p.method || '—'}</td>
                            <td>{p.reference || '—'}</td>
                            <td>{formatMoney(p.amount, p.currency || cur)}</td>
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
                ) : (
                  <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>No receipts recorded yet.</p>
                )}

                {canEdit && payCommission.status !== 'Cancelled' && (
                  <form id="commission-pay-form" onSubmit={handlePaymentSubmit}>
                    <div className="form-grid">
                      <Field label={`Amount (${cur})`} htmlFor="cpay-amount" required>
                        <input
                          id="cpay-amount"
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={payForm.amount}
                          onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))}
                          required
                        />
                      </Field>
                      <Field label="Receipt date" htmlFor="cpay-date" required>
                        <input
                          id="cpay-date"
                          type="date"
                          value={payForm.paymentDate}
                          onChange={(e) => setPayForm((f) => ({ ...f, paymentDate: e.target.value }))}
                          required
                        />
                      </Field>
                      <Field label="Method" htmlFor="cpay-method">
                        <select
                          id="cpay-method"
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
                      <Field label="Reference" htmlFor="cpay-ref">
                        <input
                          id="cpay-ref"
                          value={payForm.reference}
                          onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))}
                          placeholder="Optional"
                        />
                      </Field>
                      <Field label="Notes" htmlFor="cpay-notes" className="span-2">
                        <input
                          id="cpay-notes"
                          value={payForm.notes}
                          onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))}
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
