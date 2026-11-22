import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useUrlSearch } from '@/hooks/useUrlSearch'
import { api } from '@/api/client'
import { RowActionsMenu } from '@/components/RowActionsMenu'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import {
  formatDate,
  formatMoney,
  hasDisplayName,
  idOf,
  nameOf,
  toDateInput,
  withDisplayName,
} from '@/lib/utils'
import {
  QUANTITY_UNITS,
  asList,
  errMsg,
  fmtQty,
  newKey,
  todayInput,
  toNum,
  type CurrencyOption,
} from '@/lib/sales'

type ContractLine = {
  _id?: string | null
  product?: unknown
  productPopulated?: unknown
  quantity?: number
  quantityUnit?: string
  price?: number
  allocatedQuantity?: number
  remainingQuantity?: number
}

type ContractOption = {
  _id: string
  supplier?: unknown
  contractNumber?: string
  originCountry?: string
  contractTerms?: string
  contractTermsCustom?: string
  paymentTerms?: string
  supplierCommissionPerMt?: number
  priceCurrency?: string
  portOfShipment?: string
  portOfDischarge?: string
  remainingQuantity?: number
  totalQuantity?: number
  productLines?: ContractLine[]
  productLinesEnriched?: ContractLine[]
}

type ClientOption = { _id: string; companyName?: string; ntnNumber?: string }

type IndentLine = {
  _id?: string
  client?: unknown
  product?: unknown
  contractLineId?: string
  quantity?: number
  quantityUnit?: string
  ntnNumber?: string
}

type Indent = {
  _id: string
  salesContract?: unknown
  indentNumber?: string
  indentDate?: string
  notes?: string
  remarks?: string
  lastDateOfShipment?: string
  portOfShipment?: string
  portOfDischarge?: string
  sellingPricePerMt?: number
  sellingPriceCurrency?: string
  lines?: IndentLine[]
  commissionTotal?: number
}

type LineForm = {
  key: string
  /** Contract line key: contract line `_id`, or `p:<productId>` for legacy contracts. */
  lineKey: string
  clientId: string
  quantityUnit: string
  quantity: string
  ntnNumber: string
}

type FormState = {
  salesContractId: string
  indentNumber: string
  indentDate: string
  lastDateOfShipment: string
  portOfShipment: string
  portOfDischarge: string
  sellingPricePerMt: string
  sellingPriceCurrency: string
  remarks: string
  notes: string
}

function contractLinesOf(c?: ContractOption | null): ContractLine[] {
  if (!c) return []
  if (c.productLinesEnriched?.length) return c.productLinesEnriched
  return c.productLines || []
}

function lineKeyOf(cl: ContractLine) {
  return cl._id ? String(cl._id) : `p:${idOf(cl.product)}`
}

function matchLineKey(lines: ContractLine[], contractLineId?: string, productId?: string) {
  if (contractLineId) {
    const byId = lines.find((l) => l._id && String(l._id) === String(contractLineId))
    if (byId) return lineKeyOf(byId)
  }
  if (productId) {
    const matches = lines.filter((l) => idOf(l.product) === productId)
    if (matches.length >= 1) return lineKeyOf(matches[0])
  }
  return lines.length === 1 ? lineKeyOf(lines[0]) : ''
}

function blankLine(contractLines: ContractLine[]): LineForm {
  const only = contractLines.length === 1 ? contractLines[0] : null
  return {
    key: newKey(),
    lineKey: only ? lineKeyOf(only) : '',
    clientId: '',
    quantityUnit: only?.quantityUnit || 'MT',
    quantity: '',
    ntnNumber: '',
  }
}

function blankForm(): FormState {
  return {
    salesContractId: '',
    indentNumber: '',
    indentDate: todayInput(),
    lastDateOfShipment: '',
    portOfShipment: '',
    portOfDischarge: '',
    sellingPricePerMt: '',
    sellingPriceCurrency: 'USD',
    remarks: '',
    notes: '',
  }
}

export default function IndentsPage() {
  useEffect(() => { document.title = 'Indent' }, [])

  const { canEdit, canDelete } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [indents, setIndents] = useState<Indent[]>([])
  const [contracts, setContracts] = useState<ContractOption[]>([])
  const [clients, setClients] = useState<ClientOption[]>([])
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([{ code: 'USD' }])
  /** indentId → shipmentId (one shipment per indent) */
  const [shipmentByIndent, setShipmentByIndent] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const { search, setSearch, highlightId } = useUrlSearch()

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Indent | null>(null)
  const [form, setForm] = useState<FormState>(blankForm)
  const [lines, setLines] = useState<LineForm[]>([])
  const [saving, setSaving] = useState(false)
  const paramsHandled = useRef(false)

  const loadIndents = useCallback(async () => {
    try {
      setIndents(asList<Indent>(await api<unknown>('/api/indents')))
    } catch (e) {
      toast(errMsg(e, 'Failed to load indents'), 'error')
    }
  }, [toast])

  const loadContracts = useCallback(async () => {
    try {
      setContracts(asList<ContractOption>(await api<unknown>('/api/sales-contracts')))
    } catch (e) {
      toast(errMsg(e, 'Failed to load sales contracts'), 'error')
    }
  }, [toast])

  const loadShipmentLinks = useCallback(async () => {
    try {
      const list = asList<{ _id: string; indent?: unknown }>(await api<unknown>('/api/shipments'))
      const map: Record<string, string> = {}
      for (const s of list) {
        const indentId = idOf(s.indent)
        if (indentId && !map[indentId]) map[indentId] = s._id
      }
      setShipmentByIndent(map)
    } catch {
      /* non-blocking — Actions still work via shipments page guard */
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [cl, cur] = await Promise.allSettled([
        api<unknown>('/api/clients'),
        api<unknown>('/api/currencies'),
      ])
      if (cancelled) return
      if (cl.status === 'fulfilled') {
        setClients(
          asList<ClientOption>(cl.value).sort((a, b) => (a.companyName || '').localeCompare(b.companyName || '')),
        )
      } else {
        toast(errMsg(cl.reason, 'Failed to load clients'), 'error')
      }
      if (cur.status === 'fulfilled') {
        const list = asList<CurrencyOption>(cur.value)
        if (list.length) setCurrencies(list)
      }
      await Promise.all([loadIndents(), loadContracts(), loadShipmentLinks()])
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [loadIndents, loadContracts, loadShipmentLinks, toast])

  const contractById = useMemo(() => new Map(contracts.map((c) => [c._id, c])), [contracts])
  const selectedContract = contractById.get(form.salesContractId) || null
  const selectedContractLines = useMemo(() => contractLinesOf(selectedContract), [selectedContract])

  /** Quantity this indent already holds per contract line (so editing doesn't double count it). */
  const ownAllocation = useMemo(() => {
    const map: Record<string, number> = {}
    if (!editing || idOf(editing.salesContract) !== form.salesContractId) return map
    for (const l of editing.lines || []) {
      const key = matchLineKey(selectedContractLines, l.contractLineId, idOf(l.product))
      if (!key) continue
      map[key] = (map[key] || 0) + toNum(l.quantity)
    }
    return map
  }, [editing, form.salesContractId, selectedContractLines])

  const usage = useMemo(() => {
    const map: Record<string, number> = {}
    for (const l of lines) {
      if (!l.lineKey) continue
      map[l.lineKey] = (map[l.lineKey] || 0) + toNum(l.quantity)
    }
    return map
  }, [lines])

  const availableFor = useCallback(
    (cl: ContractLine) => {
      const key = lineKeyOf(cl)
      const remaining = cl.remainingQuantity != null ? toNum(cl.remainingQuantity) : toNum(cl.quantity)
      return remaining + (ownAllocation[key] || 0)
    },
    [ownAllocation],
  )

  const indentQtyMt = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const q = toNum(l.quantity)
        return sum + (l.quantityUnit === 'KGS' ? q / 1000 : q)
      }, 0),
    [lines],
  )

  const estimatedMargin = useMemo(() => {
    if (!selectedContract) return null
    const sell = toNum(form.sellingPricePerMt)
    if (!(sell > 0) || !(indentQtyMt > 0)) return null
    let total = 0
    for (const l of lines) {
      if (!l.lineKey || !(toNum(l.quantity) > 0)) continue
      const cl = selectedContractLines.find((x) => lineKeyOf(x) === l.lineKey)
      const buy = toNum(cl?.price)
      const qtyMt = l.quantityUnit === 'KGS' ? toNum(l.quantity) / 1000 : toNum(l.quantity)
      total += (sell - buy) * qtyMt
    }
    return Math.max(0, total)
  }, [selectedContract, selectedContractLines, form.sellingPricePerMt, lines, indentQtyMt])

  const remainingAfterSave = useMemo(() => {
    if (!selectedContract) return null
    const own =
      editing && idOf(editing.salesContract) === form.salesContractId
        ? Object.values(ownAllocation).reduce((a, b) => a + b, 0)
        : 0
    return Math.max(0, toNum(selectedContract.remainingQuantity) - indentQtyMt + own)
  }, [selectedContract, editing, form.salesContractId, ownAllocation, indentQtyMt])

  const qtyOver = useMemo(
    () => selectedContractLines.some((cl) => (usage[lineKeyOf(cl)] || 0) > availableFor(cl) + 0.0001),
    [selectedContractLines, usage, availableFor],
  )
  const qtySummaryClass = qtyOver ? 'ind-qty-summary is-over' : 'ind-qty-summary'

  const productNameOf = (cl: ContractLine, index = 0) => {
    const named = nameOf(cl.productPopulated || cl.product, ['name'])
    if (hasDisplayName(named)) return named
    return `Product line ${index + 1}`
  }

  const productLineOptionLabel = (cl: ContractLine, index: number) => {
    const name = productNameOf(cl, index)
    const rem = `${fmtQty(availableFor(cl))} ${cl.quantityUnit || 'MT'} rem`
    return `${name} · ${rem}`
  }

  const applyContract = useCallback(
    (contractId: string, base: FormState): { form: FormState; lines: LineForm[] } => {
      const c = contractById.get(contractId)
      const cls = contractLinesOf(c)
      return {
        form: {
          ...base,
          salesContractId: contractId,
          portOfShipment: base.portOfShipment || c?.portOfShipment || '',
          portOfDischarge: base.portOfDischarge || c?.portOfDischarge || '',
          sellingPriceCurrency: c?.priceCurrency || base.sellingPriceCurrency || 'USD',
        },
        lines: [blankLine(cls)],
      }
    },
    [contractById],
  )

  const openNew = useCallback(
    (contractId?: string) => {
      setEditing(null)
      if (contractId && contractById.has(contractId)) {
        const next = applyContract(contractId, blankForm())
        setForm(next.form)
        setLines(next.lines)
      } else {
        setForm(blankForm())
        setLines([])
      }
      setModalOpen(true)
    },
    [applyContract, contractById],
  )

  const openEdit = (ind: Indent) => {
    const contractId = idOf(ind.salesContract)
    const cls = contractLinesOf(contractById.get(contractId))
    setEditing(ind)
    setForm({
      salesContractId: contractId,
      indentNumber: ind.indentNumber || '',
      indentDate: toDateInput(ind.indentDate) || todayInput(),
      lastDateOfShipment: toDateInput(ind.lastDateOfShipment),
      portOfShipment: ind.portOfShipment || '',
      portOfDischarge: ind.portOfDischarge || '',
      sellingPricePerMt: ind.sellingPricePerMt != null ? String(ind.sellingPricePerMt) : '',
      sellingPriceCurrency: ind.sellingPriceCurrency || 'USD',
      remarks: ind.remarks || '',
      notes: ind.notes || '',
    })
    const mapped = (ind.lines || []).map((l) => ({
      key: newKey(),
      lineKey: matchLineKey(cls, l.contractLineId, idOf(l.product)),
      clientId: idOf(l.client),
      quantityUnit: l.quantityUnit || 'MT',
      quantity: l.quantity != null ? String(l.quantity) : '',
      ntnNumber: l.ntnNumber || '',
    }))
    setLines(mapped.length ? mapped : [blankLine(cls)])
    setModalOpen(true)
  }

  // ?new=1 and/or ?contract=<id> open the create form once data is ready
  useEffect(() => {
    if (loading || paramsHandled.current) return
    const contractParam = searchParams.get('contract')
    const wantsNew = searchParams.get('new') === '1'
    if (!contractParam && !wantsNew) return
    paramsHandled.current = true
    if (canEdit) openNew(contractParam || undefined)
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    next.delete('contract')
    setSearchParams(next, { replace: true })
  }, [loading, searchParams, setSearchParams, canEdit, openNew])

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
    setEditing(null)
  }

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const onContractChange = (contractId: string) => {
    if (!contractId) {
      setForm((f) => ({ ...f, salesContractId: '' }))
      setLines([])
      return
    }
    const next = applyContract(contractId, form)
    setForm(next.form)
    setLines(next.lines)
  }

  const updateLine = (key: string, patch: Partial<LineForm>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const onLineProductChange = (key: string, lineKey: string) => {
    const cl = selectedContractLines.find((x) => lineKeyOf(x) === lineKey)
    updateLine(key, { lineKey, quantityUnit: cl?.quantityUnit || 'MT' })
  }

  const onLineClientChange = (key: string, clientId: string) => {
    const client = clients.find((c) => c._id === clientId)
    updateLine(key, { clientId, ...(client?.ntnNumber ? { ntnNumber: client.ntnNumber } : {}) })
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    if (!form.salesContractId) return toast('Select a sales contract.', 'error')
    if (!form.indentDate) return toast('Indent date is required.', 'error')
    if (form.sellingPricePerMt === '' || toNum(form.sellingPricePerMt) < 0) {
      return toast('Selling price per MT is required.', 'error')
    }
    if (!lines.length) return toast('Add at least one client line.', 'error')
    if (lines.some((l) => !l.lineKey || !l.clientId || !(toNum(l.quantity) > 0))) {
      return toast('Each line needs a product, a client and a quantity.', 'error')
    }
    const overIdx = selectedContractLines.findIndex(
      (cl) => (usage[lineKeyOf(cl)] || 0) > availableFor(cl) + 0.0001,
    )
    if (overIdx >= 0) {
      const over = selectedContractLines[overIdx]
      return toast(
        `Quantity for ${productNameOf(over, overIdx)} (${fmtQty(usage[lineKeyOf(over)])}) exceeds remaining (${fmtQty(availableFor(over))}).`,
        'error',
      )
    }

    const mappedLines = lines.map((l) => {
      const cl = selectedContractLines.find((x) => lineKeyOf(x) === l.lineKey)
      const productId = cl ? idOf(cl.product) : ''
      return {
        clientId: l.clientId,
        productId: productId || undefined,
        contractLineId: cl?._id ? String(cl._id) : undefined,
        quantityUnit: l.quantityUnit,
        quantity: Number(l.quantity),
        ntnNumber: l.ntnNumber.trim() || undefined,
      }
    })
    if (mappedLines.some((l) => !l.productId && !l.contractLineId)) {
      return toast('Each allocation needs a valid product line from the contract.', 'error')
    }

    const payload = {
      salesContractId: form.salesContractId,
      indentNumber: form.indentNumber.trim() || undefined,
      indentDate: form.indentDate,
      notes: form.notes.trim(),
      remarks: form.remarks.trim(),
      lastDateOfShipment: form.lastDateOfShipment,
      portOfShipment: form.portOfShipment.trim(),
      portOfDischarge: form.portOfDischarge.trim(),
      sellingPricePerMt: Number(form.sellingPricePerMt),
      sellingPriceCurrency: form.sellingPriceCurrency.trim(),
      lines: mappedLines,
    }

    setSaving(true)
    try {
      const result = await api<{ indent?: Indent }>(editing ? `/api/indents/${editing._id}` : '/api/indents', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      })
      const savedId = result?.indent?._id || editing?._id
      toast(editing ? 'Indent updated' : 'Indent saved', 'success')
      setModalOpen(false)
      setEditing(null)
      await Promise.all([loadIndents(), loadContracts(), loadShipmentLinks()])
      if (!editing && savedId) {
        const existingShipment = shipmentByIndent[savedId]
        if (existingShipment) {
          /* already linked — don't prompt to create another */
        } else if (window.confirm('Create a shipment for this indent?')) {
          navigate(`/shipments?indent=${encodeURIComponent(savedId)}&new=1`)
        }
      }
    } catch (err) {
      toast(errMsg(err, 'Save failed'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (ind: Indent) => {
    if (!window.confirm(`Delete indent ${ind.indentNumber || ''}?`)) return
    try {
      await api(`/api/indents/${ind._id}`, { method: 'DELETE' })
      toast('Indent deleted', 'success')
      await Promise.all([loadIndents(), loadContracts()])
    } catch (err) {
      toast(errMsg(err, 'Delete failed'), 'error')
    }
  }

  const printIndent = (id: string) => {
    window.open(`/api/indents/${id}/print`, '_blank')
  }

  const sc = selectedContract
  const sumSupplier = sc ? nameOf(sc.supplier, ['companyName']) : '—'
  const sumOrigin = sc?.originCountry || '—'
  const sumTotal = sc ? fmtQty(sc.totalQuantity) : '—'
  const sumAllocated = sc
    ? fmtQty(Math.max(0, toNum(sc.totalQuantity) - toNum(sc.remainingQuantity)))
    : '—'
  const sumRemaining = sc ? fmtQty(sc.remainingQuantity) : '—'
  const sumTerms = !sc
    ? '—'
    : sc.contractTerms === 'Custom'
      ? sc.contractTermsCustom || 'Custom'
      : sc.contractTerms || '—'
  const supplierCommissionHint = sc?.supplierCommissionPerMt
    ? `Commission from supplier: ${sc.supplierCommissionPerMt} / MT`
    : ''

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return indents
    return indents.filter((i) => {
      const hay = [
        i.indentNumber,
        nameOf(i.salesContract, ['contractNumber']),
        nameOf((i.salesContract as { supplier?: unknown } | undefined)?.supplier, ['companyName']),
        ...(i.lines || []).flatMap((l) => [nameOf(l.client, ['companyName']), nameOf(l.product, ['name'])]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [indents, search])

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Operations</p>
          <h1>Indents</h1>
          <p className="page-lede">Purchase indents linked to sales contracts.</p>
        </div>
      </header>

      <div className="products-toolbar list-toolbar">
        <div className="toolbar-row">
          <div className="toolbar-group toolbar-search">
            <label htmlFor="indSearchInput">Search</label>
            <input
              type="search"
              id="indSearchInput"
              placeholder="Indent #, contract, client…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {canEdit ? (
            <div className="toolbar-actions">
              <button
                type="button"
                className="btn toolbar-cta"
                id="toggleFormBtn"
                onClick={() => {
                  if (modalOpen && !editing) closeModal()
                  else openNew()
                }}
              >
                {modalOpen && !editing ? 'Close form' : 'New indent'}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className={`form-container${modalOpen ? ' show' : ' is-collapsed'}`} id="indentFormWrap">
        <h2 style={{ marginBottom: 12 }} id="indFormTitle">
          {editing ? 'Edit indent' : 'Create indent'}
        </h2>
        <form id="indentForm" onSubmit={handleSubmit}>
          <div className="ind-form-row">
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="indSalesContract">Sales contract *</label>
              <select
                id="indSalesContract"
                required
                value={form.salesContractId}
                onChange={(e) => onContractChange(e.target.value)}
              >
                <option value="">Select sales contract</option>
                {contracts.map((c) => {
                  const supplier = nameOf(c.supplier, ['companyName'])
                  const rem = fmtQty(c.remainingQuantity ?? c.totalQuantity)
                  return (
                    <option key={c._id} value={c._id}>
                      {c.contractNumber}
                      {hasDisplayName(supplier) ? ` — ${supplier}` : ''}
                      {` (remaining: ${rem})`}
                    </option>
                  )
                })}
              </select>
            </div>
          </div>

          <div className={`ind-contract-summary${sc ? ' visible' : ''}`} id="indContractSummary">
            <dl>
              <div>
                <dt>Supplier</dt>
                <dd id="indSumSupplier">{sumSupplier}</dd>
              </div>
              <div>
                <dt>Origin</dt>
                <dd id="indSumOrigin">{sumOrigin}</dd>
              </div>
              <div>
                <dt>Contract qty</dt>
                <dd id="indSumTotal">{sumTotal}</dd>
              </div>
              <div>
                <dt>Allocated</dt>
                <dd id="indSumAllocated">{sumAllocated}</dd>
              </div>
              <div>
                <dt>Remaining</dt>
                <dd id="indSumRemaining">{sumRemaining}</dd>
              </div>
              <div>
                <dt>Terms</dt>
                <dd id="indSumTerms">{sumTerms}</dd>
              </div>
            </dl>
          </div>

          <div className={`ind-product-lines${selectedContract ? ' visible' : ''}`} id="indProductLinesBox">
            <strong>Product lines (remaining qty)</strong>
            <ul id="indProductLinesList">
              {selectedContractLines.map((cl, i) => (
                <li key={lineKeyOf(cl) + i}>
                  {productNameOf(cl, i)} — {fmtQty(availableFor(cl))} {cl.quantityUnit || 'MT'} remaining
                  {usage[lineKeyOf(cl)] ? ` (this indent: ${fmtQty(usage[lineKeyOf(cl)])})` : ''}
                </li>
              ))}
            </ul>
          </div>

          <div className="ind-form-row">
            <div>
              <label htmlFor="indNumber">Indent number</label>
              <input
                type="text"
                id="indNumber"
                placeholder="Auto-generated if blank"
                value={form.indentNumber}
                onChange={(e) => setField('indentNumber', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="indDate">Indent date *</label>
              <input
                type="date"
                id="indDate"
                required
                value={form.indentDate}
                onChange={(e) => setField('indentDate', e.target.value)}
              />
            </div>
          </div>

          <div className="ind-form-row">
            <div>
              <label htmlFor="indSellingPrice">Selling price per MT *</label>
              <input
                type="number"
                id="indSellingPrice"
                min={0}
                step="any"
                required
                placeholder="Client selling price"
                value={form.sellingPricePerMt}
                onChange={(e) => setField('sellingPricePerMt', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="indSellingPriceCurrency">Currency</label>
              <input
                type="text"
                id="indSellingPriceCurrency"
                placeholder="USD"
                value={form.sellingPriceCurrency}
                onChange={(e) => setField('sellingPriceCurrency', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="indLastDateOfShipment">Last date of shipment</label>
              <input
                type="date"
                id="indLastDateOfShipment"
                value={form.lastDateOfShipment}
                onChange={(e) => setField('lastDateOfShipment', e.target.value)}
              />
            </div>
          </div>
          <div className="ind-form-row">
            <div>
              <label htmlFor="indPortOfShipment">Port of shipment</label>
              <input
                type="text"
                id="indPortOfShipment"
                placeholder="From contract"
                value={form.portOfShipment}
                onChange={(e) => setField('portOfShipment', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="indPortOfDischarge">Port of discharge</label>
              <input
                type="text"
                id="indPortOfDischarge"
                placeholder="From contract"
                value={form.portOfDischarge}
                onChange={(e) => setField('portOfDischarge', e.target.value)}
              />
            </div>
          </div>
          <p className="ind-qty-summary" id="indCommissionSummary">
            Estimated commission from client:{' '}
            {estimatedMargin != null
              ? formatMoney(estimatedMargin, form.sellingPriceCurrency || 'USD')
              : '—'}
          </p>
          <p className="form-hint" id="indSupplierCommissionHint" style={{ marginTop: 4 }}>
            {supplierCommissionHint}
          </p>

          <h3 className="product-form-section-title">Client allocations</h3>
          <p className="form-hint">
            Choose product line, client, and quantity. Each line cannot exceed that product&apos;s remaining
            quantity on the contract.
          </p>

          <div className="ind-lines-wrap">
            <table className="ind-lines-table">
              <thead>
                <tr>
                  <th>Product line *</th>
                  <th>Client *</th>
                  <th>Quantity *</th>
                  <th>NTN #</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="indLinesBody">
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td>
                      <select
                        required
                        value={l.lineKey}
                        onChange={(e) => onLineProductChange(l.key, e.target.value)}
                        disabled={!selectedContract}
                      >
                        <option value="">Select product</option>
                        {selectedContractLines.map((cl, i) => (
                          <option key={lineKeyOf(cl) + i} value={lineKeyOf(cl)}>
                            {productLineOptionLabel(cl, i)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        required
                        value={l.clientId}
                        onChange={(e) => onLineClientChange(l.key, e.target.value)}
                      >
                        <option value="">Select client</option>
                        {clients.map((c) => (
                          <option key={c._id} value={c._id}>
                            {c.companyName}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0.001"
                        step="any"
                        required
                        value={l.quantity}
                        onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={l.ntnNumber}
                        onChange={(e) => updateLine(l.key, { ntnNumber: e.target.value })}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="action-btn"
                        onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="action-btn"
            id="indAddLineBtn"
            disabled={!selectedContract}
            onClick={() => setLines((p) => [...p, blankLine(selectedContractLines)])}
          >
            + Add client
          </button>
          <p className={qtySummaryClass} id="indQtySummary">
            This indent: {fmtQty(indentQtyMt)} MT — Remaining after save:{' '}
            {remainingAfterSave != null ? fmtQty(remainingAfterSave) : '—'}
          </p>

          <label htmlFor="indRemarks">Remarks</label>
          <textarea
            id="indRemarks"
            rows={2}
            placeholder="Remarks for this indent"
            value={form.remarks}
            onChange={(e) => setField('remarks', e.target.value)}
          />

          <label htmlFor="indNotes">Notes (optional)</label>
          <textarea id="indNotes" rows={2} value={form.notes} onChange={(e) => setField('notes', e.target.value)} />

          <div className="form-actions">
            <button type="submit" className="btn" id="indSubmitBtn" disabled={saving || !canEdit}>
              {saving ? 'Saving…' : 'Save indent'}
            </button>
            {editing ? (
              <button type="button" className="action-btn" id="indCancelEditBtn" disabled={saving} onClick={closeModal}>
                Cancel edit
              </button>
            ) : null}
          </div>
        </form>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Indent #</th>
              <th>Date</th>
              <th>Contract</th>
              <th>Product</th>
              <th>Clients / Qty</th>
              <th>Indent qty</th>
              <th>Margin</th>
              <th>Contract remaining</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="indTableBody">
            {loading ? (
              <tr>
                <td colSpan={9}>Loading…</td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9}>{indents.length ? 'No indents match your search.' : 'No indents yet.'}</td>
              </tr>
            ) : (
              filtered.map((ind) => {
                const cur = ind.sellingPriceCurrency || 'USD'
                const qty = (ind.lines || []).reduce(
                  (s, l) => s + (l.quantityUnit === 'KGS' ? toNum(l.quantity) / 1000 : toNum(l.quantity)),
                  0,
                )
                const products = [
                  ...new Set((ind.lines || []).map((l) => nameOf(l.product, ['name'])).filter((n) => n !== '—')),
                ].join(', ')
                const contractId = idOf(ind.salesContract)
                const rem = contractById.get(contractId)?.remainingQuantity
                return (
                  <tr key={ind._id} className={highlightId === ind._id ? 'row-highlight' : undefined}>
                    <td>{ind.indentNumber || '—'}</td>
                    <td>{formatDate(ind.indentDate)}</td>
                    <td>{nameOf(ind.salesContract, ['contractNumber'])}</td>
                    <td>{products || '—'}</td>
                    <td>
                      {(ind.lines || []).map((l, i) => (
                        <div key={l._id || i}>
                          {withDisplayName(
                            nameOf(l.client, ['companyName']),
                            `${fmtQty(l.quantity)} ${l.quantityUnit || 'MT'}`,
                            ': ',
                          )}
                        </div>
                      ))}
                    </td>
                    <td>{fmtQty(qty)} MT</td>
                    <td>{ind.commissionTotal ? formatMoney(ind.commissionTotal, cur) : '—'}</td>
                    <td>{rem != null ? fmtQty(rem) : '—'}</td>
                    <td className="table-actions-cell">
                      <RowActionsMenu
                        items={[
                          { label: 'Print', onClick: () => printIndent(ind._id) },
                          shipmentByIndent[ind._id]
                            ? {
                                label: 'Open shipment',
                                href: `/shipments?indent=${encodeURIComponent(ind._id)}&new=1`,
                              }
                            : {
                                label: 'Create shipment',
                                href: `/shipments?indent=${encodeURIComponent(ind._id)}&new=1`,
                                hidden: !canEdit,
                              },
                          { label: 'Edit', hidden: !canEdit, onClick: () => openEdit(ind) },
                          {
                            label: 'Delete',
                            danger: true,
                            hidden: !canDelete,
                            onClick: () => void handleDelete(ind),
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
    </>
  )
}
