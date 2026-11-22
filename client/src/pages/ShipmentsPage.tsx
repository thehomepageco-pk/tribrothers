import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useUrlSearch } from '@/hooks/useUrlSearch'
import { ApiError, api, apiForm } from '@/api/client'
import { RowActionsMenu } from '@/components/RowActionsMenu'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/ui/Field'
import { formatDate, hasDisplayName, idOf, nameOf, toDateInput } from '@/lib/utils'
import {
  QUANTITY_UNITS,
  SHIPMENT_TYPES,
  asList,
  badgeClassForStatus,
  errMsg,
  fmtQty,
  suggestNumber,
  toNum,
  uploadUrl,
} from '@/lib/sales'

const STATUSES = ['Draft', 'Booked', 'In transit', 'Arrived', 'Delivered'] as const

type IndentLineOption = {
  _id?: string
  client?: unknown
  product?: unknown
  quantity?: number
  quantityUnit?: string
}

type IndentOption = {
  _id: string
  indentNumber?: string
  indentDate?: string
  portOfShipment?: string
  portOfDischarge?: string
  salesContract?: {
    _id?: string
    contractNumber?: string
    shipmentType?: string
    portOfShipment?: string
    portOfDischarge?: string
    supplier?: unknown
  } | string
  lines?: IndentLineOption[]
}

type ShipmentLine = {
  indent?: unknown
  indentLineId?: string
  client?: unknown
  product?: unknown
  quantity?: number
  quantityUnit?: string
}

type Shipment = {
  _id: string
  salesContract?: unknown
  indent?: unknown
  shipmentNumber?: string
  status?: string
  shipmentType?: string
  vesselName?: string
  blNumber?: string
  shipmentDate?: string
  etd?: string
  eta?: string
  portOfLoading?: string
  portOfDischarge?: string
  shippedQuantity?: number
  shippedQuantityUnit?: string
  freeDays?: number
  notes?: string
  blFile?: string | null
  shippingDocsFile?: string | null
  packingListFile?: string | null
  lines?: ShipmentLine[]
}

type FormState = {
  indentId: string
  shipmentNumber: string
  status: string
  shipmentType: string
  vesselName: string
  blNumber: string
  shipmentDate: string
  eta: string
  portOfLoading: string
  portOfDischarge: string
  shippedQuantity: string
  shippedQuantityUnit: string
  freeDays: string
  notes: string
}

function blankForm(shipmentNumber = ''): FormState {
  return {
    indentId: '',
    shipmentNumber,
    status: 'Draft',
    shipmentType: '',
    vesselName: '',
    blNumber: '',
    shipmentDate: '',
    eta: '',
    portOfLoading: '',
    portOfDischarge: '',
    shippedQuantity: '',
    shippedQuantityUnit: 'MT',
    freeDays: '',
    notes: '',
  }
}

function contractOf(ind?: IndentOption | null) {
  return ind && typeof ind.salesContract === 'object' ? ind.salesContract : undefined
}

export default function ShipmentsPage() {
  useEffect(() => { document.title = 'Shipment' }, [])

  const { canEdit, canDelete } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [shipments, setShipments] = useState<Shipment[]>([])
  const [indents, setIndents] = useState<IndentOption[]>([])
  const [loading, setLoading] = useState(true)
  const { search, setSearch, highlightId } = useUrlSearch()
  const [statusFilter, setStatusFilter] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Shipment | null>(null)
  const [form, setForm] = useState<FormState>(blankForm)
  const [selectedLines, setSelectedLines] = useState<string[]>([])
  const [blFile, setBlFile] = useState<File | null>(null)
  const [docsFile, setDocsFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const paramsHandled = useRef(false)

  const loadShipments = useCallback(async () => {
    try {
      setShipments(asList<Shipment>(await api<unknown>('/api/shipments')))
    } catch (e) {
      toast(errMsg(e, 'Failed to load shipments'), 'error')
    }
  }, [toast])

  const loadIndents = useCallback(async () => {
    try {
      setIndents(asList<IndentOption>(await api<unknown>('/api/indents')))
    } catch (e) {
      toast(errMsg(e, 'Failed to load indents'), 'error')
    }
  }, [toast])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await Promise.all([loadShipments(), loadIndents()])
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [loadShipments, loadIndents])

  const indentById = useMemo(() => new Map(indents.map((i) => [i._id, i])), [indents])
  const selectedIndent = indentById.get(form.indentId) || null

  const nextNumber = useCallback(
    () =>
      suggestNumber(
        'SH',
        shipments.map((s) => s.shipmentNumber),
      ),
    [shipments],
  )

  /** Fill empty fields from the chosen indent / contract (same defaults as the legacy page). */
  const applyIndent = useCallback(
    (indentId: string, base: FormState): FormState => {
      const ind = indentById.get(indentId)
      if (!ind) return { ...base, indentId }
      const contract = contractOf(ind)
      const lines = ind.lines || []
      const totalQty = lines.reduce((s, l) => s + toNum(l.quantity), 0)
      return {
        ...base,
        indentId,
        shipmentType: base.shipmentType || contract?.shipmentType || '',
        portOfLoading: base.portOfLoading || contract?.portOfShipment || ind.portOfShipment || '',
        portOfDischarge: base.portOfDischarge || contract?.portOfDischarge || ind.portOfDischarge || '',
        shippedQuantity: base.shippedQuantity || (totalQty ? String(totalQty) : ''),
        shippedQuantityUnit: base.shippedQuantity ? base.shippedQuantityUnit : lines[0]?.quantityUnit || 'MT',
      }
    },
    [indentById],
  )

  const shipmentForIndent = useCallback(
    (indentId?: string | null) => {
      if (!indentId) return null
      return shipments.find((s) => idOf(s.indent) === indentId) || null
    },
    [shipments],
  )

  const openEdit = useCallback((s: Shipment) => {
    setEditing(s)
    setForm({
      indentId: idOf(s.indent),
      shipmentNumber: s.shipmentNumber || '',
      status: s.status || 'Draft',
      shipmentType: s.shipmentType || '',
      vesselName: s.vesselName || '',
      blNumber: s.blNumber || '',
      shipmentDate: toDateInput(s.shipmentDate || s.etd),
      eta: toDateInput(s.eta),
      portOfLoading: s.portOfLoading || '',
      portOfDischarge: s.portOfDischarge || '',
      shippedQuantity: s.shippedQuantity != null ? String(s.shippedQuantity) : '',
      shippedQuantityUnit: s.shippedQuantityUnit || 'MT',
      freeDays: s.freeDays != null ? String(s.freeDays) : '',
      notes: s.notes || '',
    })
    setSelectedLines((s.lines || []).map((l) => String(l.indentLineId || '')).filter(Boolean))
    setBlFile(null)
    setDocsFile(null)
    setModalOpen(true)
  }, [])

  const openNew = useCallback(
    (indentId?: string) => {
      if (indentId) {
        const existing = shipmentForIndent(indentId)
        if (existing) {
          toast('A shipment already exists for this indent — opening it instead.', 'info')
          openEdit(existing)
          return
        }
      }
      setEditing(null)
      let next = blankForm(nextNumber())
      let lineIds: string[] = []
      if (indentId && indentById.has(indentId)) {
        next = applyIndent(indentId, next)
        lineIds = (indentById.get(indentId)?.lines || []).map((l) => String(l._id || '')).filter(Boolean)
      }
      setForm(next)
      setSelectedLines(lineIds)
      setBlFile(null)
      setDocsFile(null)
      setModalOpen(true)
    },
    [applyIndent, indentById, nextNumber, openEdit, shipmentForIndent, toast],
  )

  // ?new=1 and/or ?indent=<id> — open existing shipment when one already exists for the indent
  useEffect(() => {
    if (loading || paramsHandled.current) return
    const indentParam = searchParams.get('indent')
    const wantsNew = searchParams.get('new') === '1'
    if (!indentParam && !wantsNew) return
    paramsHandled.current = true
    if (canEdit) openNew(indentParam || undefined)
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    next.delete('indent')
    setSearchParams(next, { replace: true })
  }, [loading, searchParams, setSearchParams, canEdit, openNew])

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
    setEditing(null)
  }

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const onIndentChange = (indentId: string) => {
    if (!editing && indentId) {
      const existing = shipmentForIndent(indentId)
      if (existing) {
        toast('A shipment already exists for this indent — opening it instead.', 'info')
        openEdit(existing)
        return
      }
    }
    setForm((f) => applyIndent(indentId, f))
    const ind = indentById.get(indentId)
    setSelectedLines((ind?.lines || []).map((l) => String(l._id || '')).filter(Boolean))
  }

  const toggleLine = (id: string) =>
    setSelectedLines((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    if (!form.indentId) return toast('Select an indent.', 'error')
    if (!form.shipmentNumber.trim()) return toast('Enter a shipment number.', 'error')
    if (!form.status) return toast('Select a status.', 'error')

    const contract = contractOf(selectedIndent)
    const salesContractId = contract?._id || (selectedIndent ? idOf(selectedIndent.salesContract) : '')

    const lineChoices = (selectedIndent?.lines || [])
      .filter((l) => l._id && selectedLines.includes(String(l._id)))
      .map((l) => ({
        indent: selectedIndent?._id,
        indentLineId: l._id,
        client: idOf(l.client) || undefined,
        product: idOf(l.product) || undefined,
        quantity: toNum(l.quantity) || undefined,
        quantityUnit: l.quantityUnit || 'MT',
      }))

    const fd = new FormData()
    fd.append('indentId', form.indentId)
    if (salesContractId) fd.append('salesContractId', salesContractId)
    fd.append('shipmentNumber', form.shipmentNumber.trim())
    fd.append('status', form.status)
    fd.append('shipmentType', form.shipmentType)
    fd.append('vesselName', form.vesselName.trim())
    fd.append('blNumber', form.blNumber.trim())
    fd.append('shipmentDate', form.shipmentDate)
    fd.append('etd', form.shipmentDate)
    fd.append('eta', form.eta)
    fd.append('portOfLoading', form.portOfLoading.trim())
    fd.append('portOfDischarge', form.portOfDischarge.trim())
    fd.append('shippedQuantity', form.shippedQuantity)
    fd.append('shippedQuantityUnit', form.shippedQuantityUnit)
    fd.append('freeDays', form.freeDays)
    fd.append('notes', form.notes.trim())
    fd.append('lines', JSON.stringify(lineChoices))

    if (editing) {
      fd.append('keepBlFile', blFile ? 'false' : editing.blFile ? 'true' : 'false')
      fd.append(
        'keepShippingDocsFile',
        docsFile ? 'false' : editing.shippingDocsFile || editing.packingListFile ? 'true' : 'false',
      )
    }
    if (blFile) fd.append('blFile', blFile)
    if (docsFile) fd.append('shippingDocsFile', docsFile)

    setSaving(true)
    try {
      const result = await apiForm<Shipment & { shipment?: Shipment }>(
        editing ? `/api/shipments/${editing._id}` : '/api/shipments',
        fd,
        editing ? 'PUT' : 'POST',
      )
      const savedId = result?.shipment?._id || result?._id || editing?._id
      toast(editing ? 'Shipment updated' : 'Shipment saved', 'success')
      setModalOpen(false)
      setEditing(null)
      await loadShipments()
      if (!editing && savedId && window.confirm('Create an invoice for this shipment?')) {
        navigate(`/invoices?shipment=${encodeURIComponent(savedId)}&new=1`)
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const shipmentId =
          err.data && typeof err.data === 'object' && err.data !== null && 'shipmentId' in err.data
            ? String((err.data as { shipmentId: unknown }).shipmentId)
            : ''
        toast(err.message || 'A shipment already exists for this indent.', 'info')
        const existing = shipmentId ? shipments.find((s) => s._id === shipmentId) : shipmentForIndent(form.indentId)
        if (existing) openEdit(existing)
        else if (form.indentId) {
          paramsHandled.current = false
          navigate(`/shipments?indent=${encodeURIComponent(form.indentId)}&new=1`)
        }
      } else {
        toast(errMsg(err, 'Save failed'), 'error')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (s: Shipment) => {
    if (!window.confirm(`Delete shipment ${s.shipmentNumber || ''}?`)) return
    try {
      await api(`/api/shipments/${s._id}`, { method: 'DELETE' })
      toast('Shipment deleted', 'success')
      await loadShipments()
    } catch (err) {
      toast(errMsg(err, 'Delete failed'), 'error')
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return shipments.filter((s) => {
      if (statusFilter && s.status !== statusFilter) return false
      if (!q) return true
      const hay = [
        s.shipmentNumber,
        nameOf(s.indent, ['indentNumber']),
        nameOf(s.salesContract, ['contractNumber']),
        s.vesselName,
        s.blNumber,
        s.status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [shipments, search, statusFilter])

  const editingDocs = editing ? editing.shippingDocsFile || editing.packingListFile : null

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Operations</p>
          <h1>Shipments</h1>
        </div>
      </header>

      <div className="pipeline">
        <span className="pipeline-label">Status</span>
        {STATUSES.map((st, i) => (
          <span key={st} style={{ display: 'contents' }}>
            {i > 0 && <span className="pipeline-arrow">→</span>}
            <button
              type="button"
              className="pipeline-step"
              style={statusFilter === st ? { background: 'var(--accent)', color: '#fff' } : undefined}
              onClick={() => setStatusFilter(statusFilter === st ? '' : st)}
            >
              {st} ({shipments.filter((s) => (s.status || 'Draft') === st).length})
            </button>
          </span>
        ))}
      </div>

      <div className="products-toolbar list-toolbar">
        <div className="toolbar-row">
          <div className="toolbar-group toolbar-search">
            <label htmlFor="shipSearchInput">Search</label>
            <input
              id="shipSearchInput"
              type="search"
              placeholder="Shipment #, indent, contract, vessel, B/L…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {statusFilter ? (
            <div className="toolbar-group toolbar-compact">
              <label>&nbsp;</label>
              <button type="button" className="action-btn" onClick={() => setStatusFilter('')}>
                Clear status filter
              </button>
            </div>
          ) : null}
          {canEdit ? (
            <div className="toolbar-actions">
              <button type="button" className="btn toolbar-cta" onClick={() => openNew()}>
                New shipment
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="loading-block">Loading shipments…</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Shipment #</th>
                <th>Indent</th>
                <th>Status</th>
                <th>Vessel</th>
                <th>B/L</th>
                <th>Shipment date</th>
                <th>ETA</th>
                <th>Type</th>
                <th>Quantity</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    <div className="empty-state">
                      {shipments.length ? 'No shipments match your filters.' : 'No shipments yet.'}
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((s) => {
                  const docs = s.shippingDocsFile || s.packingListFile
                  return (
                    <tr key={s._id}>
                      <td>
                        <strong>{s.shipmentNumber || '—'}</strong>
                        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                          {nameOf(s.salesContract, ['contractNumber'])}
                        </div>
                      </td>
                      <td>{nameOf(s.indent, ['indentNumber'])}</td>
                      <td>
                        <span className={badgeClassForStatus(s.status)}>{s.status || 'Draft'}</span>
                      </td>
                      <td>{s.vesselName || '—'}</td>
                      <td>{s.blNumber || '—'}</td>
                      <td>{formatDate(s.shipmentDate || s.etd)}</td>
                      <td>{formatDate(s.eta)}</td>
                      <td>{s.shipmentType || '—'}</td>
                      <td>
                        {s.shippedQuantity != null
                          ? `${fmtQty(s.shippedQuantity)} ${s.shippedQuantityUnit || 'MT'}`
                          : '—'}
                      </td>
                      <td className="table-actions-cell">
                        <RowActionsMenu
                          items={[
                            {
                              label: 'B/L',
                              hidden: !s.blFile,
                              onClick: () => window.open(uploadUrl(s.blFile!), '_blank'),
                            },
                            {
                              label: 'Docs',
                              hidden: !docs,
                              onClick: () => window.open(uploadUrl(docs!), '_blank'),
                            },
                            {
                              label: 'Invoice',
                              href: `/invoices?shipment=${encodeURIComponent(s._id)}`,
                              hidden: !canEdit,
                            },
                            { label: 'Edit', hidden: !canEdit, onClick: () => openEdit(s) },
                            {
                              label: 'Delete',
                              danger: true,
                              hidden: !canDelete,
                              onClick: () => handleDelete(s),
                            },
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

      {modalOpen && (
        <Modal
          large
          title={editing ? 'Edit shipment' : 'Create shipment'}
          onClose={closeModal}
          footer={
            <>
              <button type="button" className="action-btn" onClick={closeModal} disabled={saving}>
                Cancel
              </button>
              <button type="submit" form="shipment-form" className="btn" disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Save shipment'}
              </button>
            </>
          }
        >
          <form id="shipment-form" onSubmit={handleSubmit}>
            <div className="form-grid">
              <Field label="Indent" htmlFor="sh-indent" required className="span-2">
                <select
                  id="sh-indent"
                  value={form.indentId}
                  onChange={(e) => onIndentChange(e.target.value)}
                  required
                  disabled={!!editing}
                >
                  <option value="">Select indent</option>
                  {indents.map((i) => {
                    const c = contractOf(i)
                    const supplier = nameOf(c?.supplier, ['companyName'])
                    const contractNo = c?.contractNumber || ''
                    const parts = [i.indentNumber, contractNo].filter(Boolean)
                    const taken = !editing && !!shipmentForIndent(i._id)
                    return (
                      <option key={i._id} value={i._id} disabled={taken}>
                        {parts.join(' — ')}
                        {hasDisplayName(supplier) ? ` (${supplier})` : ''}
                        {taken ? ' — shipment exists' : ''}
                      </option>
                    )
                  })}
                </select>
              </Field>
              <Field label="Shipment number" htmlFor="sh-number" required>
                <input
                  id="sh-number"
                  value={form.shipmentNumber}
                  onChange={(e) => setField('shipmentNumber', e.target.value)}
                  required
                />
              </Field>
              <Field label="Status" htmlFor="sh-status" required>
                <select
                  id="sh-status"
                  value={form.status}
                  onChange={(e) => setField('status', e.target.value)}
                  required
                >
                  {STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Shipment type" htmlFor="sh-type">
                <select id="sh-type" value={form.shipmentType} onChange={(e) => setField('shipmentType', e.target.value)}>
                  <option value="">—</option>
                  {SHIPMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Vessel name" htmlFor="sh-vessel">
                <input id="sh-vessel" value={form.vesselName} onChange={(e) => setField('vesselName', e.target.value)} />
              </Field>
              <Field label="B/L number" htmlFor="sh-bl">
                <input id="sh-bl" value={form.blNumber} onChange={(e) => setField('blNumber', e.target.value)} />
              </Field>
              <Field label="Shipment date" htmlFor="sh-date">
                <input
                  id="sh-date"
                  type="date"
                  value={form.shipmentDate}
                  onChange={(e) => setField('shipmentDate', e.target.value)}
                />
              </Field>
              <Field label="ETA" htmlFor="sh-eta">
                <input id="sh-eta" type="date" value={form.eta} onChange={(e) => setField('eta', e.target.value)} />
              </Field>
              <Field label="Port of loading" htmlFor="sh-pol">
                <input
                  id="sh-pol"
                  value={form.portOfLoading}
                  onChange={(e) => setField('portOfLoading', e.target.value)}
                />
              </Field>
              <Field label="Port of discharge" htmlFor="sh-pod">
                <input
                  id="sh-pod"
                  value={form.portOfDischarge}
                  onChange={(e) => setField('portOfDischarge', e.target.value)}
                />
              </Field>
              <Field label="Shipped quantity" htmlFor="sh-qty">
                <input
                  id="sh-qty"
                  type="number"
                  min="0"
                  step="any"
                  value={form.shippedQuantity}
                  onChange={(e) => setField('shippedQuantity', e.target.value)}
                />
              </Field>
              <Field label="Quantity unit" htmlFor="sh-unit">
                <select
                  id="sh-unit"
                  value={form.shippedQuantityUnit}
                  onChange={(e) => setField('shippedQuantityUnit', e.target.value)}
                >
                  {QUANTITY_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Free days" htmlFor="sh-free">
                <input
                  id="sh-free"
                  type="number"
                  min="0"
                  step="1"
                  value={form.freeDays}
                  onChange={(e) => setField('freeDays', e.target.value)}
                />
              </Field>
            </div>

            {selectedIndent && (selectedIndent.lines || []).length > 0 && (
              <div className="panel" style={{ marginTop: 18, marginBottom: 0 }}>
                <div className="panel-title">Indent lines on this shipment</div>
                {(selectedIndent.lines || []).map((l, i) => {
                  const id = String(l._id || '')
                  return (
                    <label key={id || i} className="checkbox-row" style={{ margin: '6px 0' }}>
                      <input
                        type="checkbox"
                        disabled={!id}
                        checked={id ? selectedLines.includes(id) : false}
                        onChange={() => id && toggleLine(id)}
                      />
                      <span>
                        {nameOf(l.client, ['companyName'])} / {nameOf(l.product, ['name'])} ({fmtQty(l.quantity)}{' '}
                        {l.quantityUnit || 'MT'})
                      </span>
                    </label>
                  )
                })}
              </div>
            )}

            <div className="form-grid" style={{ marginTop: 18 }}>
              <Field label="Bill of lading file" htmlFor="sh-blfile">
                <input id="sh-blfile" type="file" onChange={(e) => setBlFile(e.target.files?.[0] || null)} />
                {editing?.blFile && (
                  <small style={{ color: 'var(--text-muted)' }}>
                    Current:{' '}
                    <a href={uploadUrl(editing.blFile)} target="_blank" rel="noopener noreferrer">
                      {editing.blFile}
                    </a>
                    {blFile ? ' (will be replaced)' : ''}
                  </small>
                )}
              </Field>
              <Field label="Shipping documents file" htmlFor="sh-docsfile">
                <input id="sh-docsfile" type="file" onChange={(e) => setDocsFile(e.target.files?.[0] || null)} />
                {editingDocs && (
                  <small style={{ color: 'var(--text-muted)' }}>
                    Current:{' '}
                    <a href={uploadUrl(editingDocs)} target="_blank" rel="noopener noreferrer">
                      {editingDocs}
                    </a>
                    {docsFile ? ' (will be replaced)' : ''}
                  </small>
                )}
              </Field>
              <Field label="Notes" htmlFor="sh-notes" className="span-2">
                <textarea id="sh-notes" rows={3} value={form.notes} onChange={(e) => setField('notes', e.target.value)} />
              </Field>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
