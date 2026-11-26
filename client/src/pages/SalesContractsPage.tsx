import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useUrlSearch } from '@/hooks/useUrlSearch'
import { api, apiForm } from '@/api/client'
import { CountryPicker } from '@/components/CountryPicker'
import { RowActionsMenu } from '@/components/RowActionsMenu'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { formatDate, formatMoney, idOf, nameOf, toDateInput, withDisplayName } from '@/lib/utils'
import {
  QUANTITY_UNITS,
  SHIPMENT_TYPES,
  asList,
  errMsg,
  fmtQty,
  newKey,
  todayInput,
  toNum,
  uploadUrl,
  type CurrencyOption,
} from '@/lib/sales'

const CONTRACT_TERMS = ['CNF', 'FOB', 'Custom'] as const
const PAYMENT_TERMS = ['LC at sight', 'DP', 'CAD', 'DP at sight', 'TT', 'Custom'] as const

type SupplierOption = { _id: string; companyName?: string; country?: string }
type ProductOption = { _id: string; name?: string; hsCode?: string }
type BankAccount = {
  _id?: string
  bankName?: string
  swiftCode?: string
  accountNumber?: string
  bankAddress?: string
  isDefault?: boolean
}

type ContractLine = {
  _id?: string | null
  product?: unknown
  productPopulated?: unknown
  quantity?: number
  quantityUnit?: string
  price?: number
  itemSpecsNote?: string
  packing?: string
  itemSpecsFile?: string | null
  allocatedQuantity?: number
  remainingQuantity?: number
}

type Contract = {
  _id: string
  supplier?: unknown
  originCountry?: string
  contractNumber?: string
  contractDate?: string
  shipmentType?: string
  priceCurrency?: string
  contractTerms?: string
  contractTermsCustom?: string
  paymentTerms?: string
  paymentTermsCustom?: string
  cadDays?: number
  deliveryTime?: string
  brandName?: string
  portOfShipment?: string
  portOfDischarge?: string
  supplierCommissionPerMt?: number
  supplierCommissionCurrency?: string
  specialInstructions?: string
  supplierBank?: BankAccount
  supplierBankAccountId?: string
  contractFile?: string | null
  productLines?: ContractLine[]
  productLinesEnriched?: ContractLine[]
}

type LineForm = {
  key: string
  _id?: string
  productId: string
  quantity: string
  quantityUnit: string
  price: string
  itemSpecsNote: string
  packing: string
  itemSpecsFile?: string
}

type FormState = {
  supplierId: string
  originCountry: string
  contractNumber: string
  contractDate: string
  shipmentType: string
  priceCurrency: string
  contractTerms: string
  contractTermsCustom: string
  paymentTerms: string
  paymentTermsCustom: string
  cadDays: string
  deliveryTime: string
  brandName: string
  portOfShipment: string
  portOfDischarge: string
  supplierCommissionPerMt: string
  /** Empty means "same as price currency". */
  supplierCommissionCurrency: string
  specialInstructions: string
  bankAccountId: string
  bankName: string
  swiftCode: string
  accountNumber: string
  bankAddress: string
}

function blankLine(): LineForm {
  return {
    key: newKey(),
    productId: '',
    quantity: '',
    quantityUnit: 'MT',
    price: '',
    itemSpecsNote: '',
    packing: '',
  }
}

function blankForm(): FormState {
  return {
    supplierId: '',
    originCountry: '',
    contractNumber: '',
    contractDate: todayInput(),
    shipmentType: 'FCL',
    priceCurrency: 'USD',
    contractTerms: 'CNF',
    contractTermsCustom: '',
    paymentTerms: 'LC at sight',
    paymentTermsCustom: '',
    cadDays: '',
    deliveryTime: '',
    brandName: '',
    portOfShipment: '',
    portOfDischarge: '',
    supplierCommissionPerMt: '',
    supplierCommissionCurrency: '',
    specialInstructions: '',
    bankAccountId: '',
    bankName: '',
    swiftCode: '',
    accountNumber: '',
    bankAddress: '',
  }
}

function contractLines(c: Contract): ContractLine[] {
  if (c.productLinesEnriched?.length) return c.productLinesEnriched
  return c.productLines || []
}

function formatTerms(c: Contract) {
  if (c.contractTerms === 'Custom') return c.contractTermsCustom || 'Custom'
  return c.contractTerms || '—'
}

function formatPayment(c: Contract) {
  if (c.paymentTerms === 'Custom') return c.paymentTermsCustom || 'Custom'
  if (c.paymentTerms === 'CAD' && c.cadDays) return `CAD (${c.cadDays} days)`
  return c.paymentTerms || '—'
}

function qtyToMt(qty: number, unit: string) {
  return unit === 'KGS' ? qty / 1000 : qty
}

export default function SalesContractsPage() {
  useEffect(() => { document.title = 'Sales Contract' }, [])

  const { canEdit, canDelete } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [contracts, setContracts] = useState<Contract[]>([])
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([{ code: 'USD', name: 'US Dollar' }])
  const [loading, setLoading] = useState(true)
  const { search, setSearch, highlightId } = useUrlSearch()

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Contract | null>(null)
  const [form, setForm] = useState<FormState>(blankForm)
  const [lines, setLines] = useState<LineForm[]>([blankLine()])
  const [banks, setBanks] = useState<BankAccount[]>([])
  const [contractFile, setContractFile] = useState<File | null>(null)
  const [removeFile, setRemoveFile] = useState(false)
  const [saving, setSaving] = useState(false)
  const bankRequest = useRef(0)
  const paramsHandled = useRef(false)

  const loadContracts = useCallback(async () => {
    try {
      const data = await api<unknown>('/api/sales-contracts')
      setContracts(asList<Contract>(data))
    } catch (e) {
      toast(errMsg(e, 'Failed to load sales contracts'), 'error')
    }
  }, [toast])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [sup, prod, cur] = await Promise.allSettled([
        api<unknown>('/api/suppliers'),
        api<unknown>('/api/products'),
        api<unknown>('/api/currencies'),
      ])
      if (cancelled) return
      if (sup.status === 'fulfilled') setSuppliers(asList<SupplierOption>(sup.value))
      if (prod.status === 'fulfilled') {
        setProducts(
          asList<ProductOption>(prod.value).sort((a, b) => (a.name || '').localeCompare(b.name || '')),
        )
      }
      if (cur.status === 'fulfilled') {
        const list = asList<CurrencyOption>(cur.value)
        if (list.length) setCurrencies(list)
      }
      await loadContracts()
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [loadContracts])

  const loadBanks = useCallback(async (supplierId: string, autofillDefault: boolean) => {
    const req = ++bankRequest.current
    if (!supplierId) {
      setBanks([])
      return
    }
    try {
      const res = await api<{ bankAccounts?: BankAccount[] }>(
        `/api/suppliers/${encodeURIComponent(supplierId)}/bank-accounts`,
      )
      if (req !== bankRequest.current) return
      const list = res.bankAccounts || []
      setBanks(list)
      if (autofillDefault) {
        const def = list.find((b) => b.isDefault)
        if (def) {
          setForm((f) => ({
            ...f,
            bankAccountId: idOf(def._id),
            bankName: def.bankName || '',
            swiftCode: def.swiftCode || '',
            accountNumber: def.accountNumber || '',
            bankAddress: def.bankAddress || '',
          }))
        }
      }
    } catch {
      if (req === bankRequest.current) setBanks([])
    }
  }, [])

  const openNew = useCallback(() => {
    setEditing(null)
    setForm(blankForm())
    setLines([blankLine()])
    setBanks([])
    setContractFile(null)
    setRemoveFile(false)
    setModalOpen(true)
  }, [])

  const openEdit = useCallback(
    (c: Contract) => {
      const supplierId = idOf(c.supplier)
      setEditing(c)
      setForm({
        supplierId,
        originCountry: c.originCountry || '',
        contractNumber: c.contractNumber || '',
        contractDate: toDateInput(c.contractDate) || todayInput(),
        shipmentType: c.shipmentType || 'FCL',
        priceCurrency: c.priceCurrency || 'USD',
        contractTerms: c.contractTerms || 'CNF',
        contractTermsCustom: c.contractTermsCustom || '',
        paymentTerms: c.paymentTerms || 'LC at sight',
        paymentTermsCustom: c.paymentTermsCustom || '',
        cadDays: c.cadDays ? String(c.cadDays) : '',
        deliveryTime: c.deliveryTime || '',
        brandName: c.brandName || '',
        portOfShipment: c.portOfShipment || '',
        portOfDischarge: c.portOfDischarge || '',
        supplierCommissionPerMt: c.supplierCommissionPerMt ? String(c.supplierCommissionPerMt) : '',
        supplierCommissionCurrency:
          c.supplierCommissionCurrency && c.supplierCommissionCurrency !== (c.priceCurrency || 'USD')
            ? c.supplierCommissionCurrency
            : '',
        specialInstructions: c.specialInstructions || '',
        bankAccountId: c.supplierBankAccountId ? idOf(c.supplierBankAccountId) : '',
        bankName: c.supplierBank?.bankName || '',
        swiftCode: c.supplierBank?.swiftCode || '',
        accountNumber: c.supplierBank?.accountNumber || '',
        bankAddress: c.supplierBank?.bankAddress || '',
      })
      const src = contractLines(c)
      setLines(
        src.length
          ? src.map((l) => ({
              key: newKey(),
              _id: l._id ? String(l._id) : undefined,
              productId: idOf(l.product),
              quantity: l.quantity != null ? String(l.quantity) : '',
              quantityUnit: l.quantityUnit || 'MT',
              price: l.price != null ? String(l.price) : '',
              itemSpecsNote: l.itemSpecsNote || '',
              packing: l.packing || '',
              itemSpecsFile: l.itemSpecsFile || undefined,
            }))
          : [blankLine()],
      )
      setContractFile(null)
      setRemoveFile(false)
      setModalOpen(true)
      void loadBanks(supplierId, false)
    },
    [loadBanks],
  )

  // ?new=1 opens the create form once data is ready
  useEffect(() => {
    if (loading || paramsHandled.current) return
    if (searchParams.get('new') === '1') {
      paramsHandled.current = true
      if (canEdit) openNew()
      const next = new URLSearchParams(searchParams)
      next.delete('new')
      setSearchParams(next, { replace: true })
    }
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

  const removeLine = (key: string) =>
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.key !== key)))

  const onSupplierChange = (supplierId: string) => {
    setForm((f) => ({
      ...f,
      supplierId,
      bankAccountId: '',
      bankName: '',
      swiftCode: '',
      accountNumber: '',
      bankAddress: '',
      originCountry: f.originCountry || suppliers.find((s) => s._id === supplierId)?.country || '',
    }))
    void loadBanks(supplierId, true)
  }

  const onBankSelect = (id: string) => {
    const found = banks.find((b) => idOf(b._id) === id)
    setForm((f) => ({
      ...f,
      bankAccountId: id,
      ...(found
        ? {
            bankName: found.bankName || '',
            swiftCode: found.swiftCode || '',
            accountNumber: found.accountNumber || '',
            bankAddress: found.bankAddress || '',
          }
        : {}),
    }))
  }

  const effectiveCommissionCurrency = form.supplierCommissionCurrency || form.priceCurrency

  const contractTotal = useMemo(
    () => lines.reduce((s, l) => s + toNum(l.quantity) * toNum(l.price), 0),
    [lines],
  )
  const totalMt = useMemo(
    () => lines.reduce((s, l) => s + qtyToMt(toNum(l.quantity), l.quantityUnit), 0),
    [lines],
  )

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return

    if (!form.supplierId) return toast('Select a supplier.', 'error')
    if (!form.originCountry.trim()) return toast('Origin country is required.', 'error')
    if (!form.contractNumber.trim()) return toast('Contract number is required.', 'error')
    if (!form.contractDate) return toast('Contract date is required.', 'error')
    if (!form.deliveryTime.trim()) return toast('Delivery time is required.', 'error')
    if (form.contractTerms === 'Custom' && !form.contractTermsCustom.trim()) {
      return toast('Enter custom sales contract terms.', 'error')
    }
    if (form.paymentTerms === 'Custom' && !form.paymentTermsCustom.trim()) {
      return toast('Enter custom payment terms.', 'error')
    }
    if (form.paymentTerms === 'CAD') {
      const days = parseInt(form.cadDays, 10)
      if (!days || days < 1) return toast('Enter the number of days for CAD payment terms.', 'error')
    }
    const badLine = lines.some(
      (l) => !l.productId || !(toNum(l.quantity) > 0) || l.price === '' || toNum(l.price) < 0,
    )
    if (badLine) return toast('Complete all product lines (product, quantity, price).', 'error')

    const fd = new FormData()
    fd.append('supplierId', form.supplierId)
    fd.append('originCountry', form.originCountry.trim())
    fd.append('contractNumber', form.contractNumber.trim())
    fd.append('contractDate', form.contractDate)
    fd.append('shipmentType', form.shipmentType)
    fd.append('priceCurrency', form.priceCurrency)
    fd.append('contractTerms', form.contractTerms)
    fd.append('contractTermsCustom', form.contractTermsCustom.trim())
    fd.append('paymentTerms', form.paymentTerms)
    fd.append('paymentTermsCustom', form.paymentTermsCustom.trim())
    if (form.paymentTerms === 'CAD') fd.append('cadDays', form.cadDays)
    fd.append('deliveryTime', form.deliveryTime.trim())
    fd.append('brandName', form.brandName.trim())
    fd.append('portOfShipment', form.portOfShipment.trim())
    fd.append('portOfDischarge', form.portOfDischarge.trim())
    fd.append('supplierCommissionPerMt', form.supplierCommissionPerMt)
    fd.append('supplierCommissionCurrency', effectiveCommissionCurrency)
    fd.append('specialInstructions', form.specialInstructions.trim())
    fd.append('bankName', form.bankName.trim())
    fd.append('swiftCode', form.swiftCode.trim())
    fd.append('accountNumber', form.accountNumber.trim())
    fd.append('bankAddress', form.bankAddress.trim())
    if (form.bankAccountId) fd.append('supplierBankAccountId', form.bankAccountId)
    fd.append(
      'productLines',
      JSON.stringify(
        lines.map((l) => ({
          _id: l._id || undefined,
          productId: l.productId,
          quantity: Number(l.quantity),
          quantityUnit: l.quantityUnit,
          price: Number(l.price),
          itemSpecsNote: l.itemSpecsNote.trim(),
          packing: l.packing.trim(),
          itemSpecsFile: l.itemSpecsFile || undefined,
          keepSpecsFile: true,
        })),
      ),
    )
    if (editing?.contractFile) {
      fd.append('keepContractFile', contractFile || removeFile ? 'false' : 'true')
    }
    if (contractFile) fd.append('contractFile', contractFile)

    setSaving(true)
    try {
      const url = editing ? `/api/sales-contracts/${editing._id}` : '/api/sales-contracts'
      const result = await apiForm<{ contract?: Contract; _id?: string }>(
        url,
        fd,
        editing ? 'PUT' : 'POST',
      )
      const savedId = result?.contract?._id || result?._id || editing?._id
      toast(editing ? 'Contract updated' : 'Sales contract saved', 'success')
      setModalOpen(false)
      setEditing(null)
      await loadContracts()
      if (!editing && savedId && window.confirm('Create an indent for this contract?')) {
        navigate(`/indents?contract=${encodeURIComponent(savedId)}&new=1`)
      }
    } catch (err) {
      toast(errMsg(err, 'Save failed'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (c: Contract) => {
    if (!window.confirm(`Delete sales contract ${c.contractNumber || ''}?`)) return
    try {
      await api(`/api/sales-contracts/${c._id}`, { method: 'DELETE' })
      toast('Sales contract deleted', 'success')
      await loadContracts()
    } catch (err) {
      toast(errMsg(err, 'Delete failed'), 'error')
    }
  }

  const productName = (l: ContractLine) => {
    const populated = nameOf(l.productPopulated || l.product, ['name'])
    if (populated !== '—' && !/^[a-f0-9]{24}$/i.test(populated)) return populated
    return products.find((p) => p._id === idOf(l.product))?.name || '—'
  }

  const supplierName = (c: Contract) => {
    const named = nameOf(c.supplier, ['companyName'])
    if (named !== '—') return named
    return suppliers.find((s) => s._id === idOf(c.supplier))?.companyName || '—'
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return contracts
    return contracts.filter((c) => {
      const hay = [
        c.contractNumber,
        nameOf(c.supplier, ['companyName']),
        c.originCountry,
        c.brandName,
        ...contractLines(c).map((l) => productName(l)),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts, search, products])

  const currencyOptions = currencies.some((c) => c.code === form.priceCurrency)
    ? currencies
    : [...currencies, { code: form.priceCurrency }]

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Sales</p>
          <h1>Sales Contract</h1>
        </div>
      </header>

      <div className="products-toolbar list-toolbar">
        <div className="toolbar-row">
          <div className="toolbar-group toolbar-search">
            <label htmlFor="scSearchInput">Search</label>
            <input
              type="search"
              id="scSearchInput"
              placeholder="Contract #, supplier, product, origin…"
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
                {modalOpen && !editing ? 'Close form' : 'New contract'}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div
        className={`form-container${modalOpen ? ' show' : ' is-collapsed'}`}
        id="salesContractFormWrap"
      >
        <h2 style={{ marginBottom: 12 }} id="scFormTitle">
          {editing ? 'Edit sales contract' : 'Create sales contract'}
        </h2>
        <form id="salesContractForm" encType="multipart/form-data" onSubmit={handleSubmit}>
          <div className="sc-form-row">
            <div>
              <label htmlFor="scSupplier">Supplier *</label>
              <select
                id="scSupplier"
                required
                value={form.supplierId}
                onChange={(e) => onSupplierChange(e.target.value)}
              >
                <option value="">Select supplier</option>
                {suppliers.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.companyName}
                    {s.country ? ` (${s.country})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="scOriginCountry">Origin (country) *</label>
              <CountryPicker
                id="scOriginCountry"
                required
                placeholder="Search country of origin…"
                value={form.originCountry}
                onChange={(country) => setField('originCountry', country)}
                onSelect={(country) => setField('originCountry', country)}
              />
            </div>
            <div>
              <label htmlFor="scContractNumber">Contract number *</label>
              <input
                type="text"
                id="scContractNumber"
                required
                placeholder="e.g. SC-2026-001"
                value={form.contractNumber}
                onChange={(e) => setField('contractNumber', e.target.value)}
              />
            </div>
          </div>

          <div className="sc-form-row">
            <div>
              <label htmlFor="scContractDate">Contract date *</label>
              <input
                type="date"
                id="scContractDate"
                required
                value={form.contractDate}
                onChange={(e) => setField('contractDate', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="scShipmentType">Shipment *</label>
              <select
                id="scShipmentType"
                required
                value={form.shipmentType}
                onChange={(e) => setField('shipmentType', e.target.value)}
              >
                <option value="">Select shipment</option>
                {SHIPMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="scPriceCurrency">Price currency *</label>
              <select
                id="scPriceCurrency"
                required
                value={form.priceCurrency}
                onChange={(e) => setField('priceCurrency', e.target.value)}
              >
                {currencyOptions.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                    {c.name ? ` — ${c.name}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <h3 className="product-form-section-title">Products</h3>
          <p className="form-hint">
            Add one or more product lines. Search and select existing products. Quantity unit is KGS or MT.
          </p>

          <div className="sc-lines-wrap">
            <table className="sc-lines-table">
              <thead>
                <tr>
                  <th>Product *</th>
                  <th>Qty *</th>
                  <th>Unit *</th>
                  <th id="scPriceColHeader">Unit price *</th>
                  <th>Item specs note</th>
                  <th>Packing</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="scLinesBody">
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td>
                      <select
                        className="sc-line-product"
                        required
                        value={l.productId}
                        onChange={(e) => updateLine(l.key, { productId: e.target.value })}
                      >
                        <option value="">Select product</option>
                        {products.map((p) => (
                          <option key={p._id} value={p._id}>
                            {p.name}
                            {p.hsCode ? ` (${p.hsCode})` : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="sc-line-qty"
                        type="number"
                        min="0.001"
                        step="any"
                        required
                        value={l.quantity}
                        onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className="sc-line-unit"
                        value={l.quantityUnit}
                        onChange={(e) => updateLine(l.key, { quantityUnit: e.target.value })}
                      >
                        {QUANTITY_UNITS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="sc-line-price"
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        value={l.price}
                        onChange={(e) => updateLine(l.key, { price: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="sc-line-specs-note"
                        type="text"
                        value={l.itemSpecsNote}
                        onChange={(e) => updateLine(l.key, { itemSpecsNote: e.target.value })}
                        placeholder="Item specs…"
                      />
                    </td>
                    <td>
                      <input
                        className="sc-line-packing"
                        type="text"
                        value={l.packing}
                        onChange={(e) => updateLine(l.key, { packing: e.target.value })}
                        placeholder="Packing"
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => removeLine(l.key)}
                        disabled={lines.length <= 1}
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
            id="scAddLineBtn"
            onClick={() => setLines((p) => [...p, blankLine()])}
          >
            + Add product line
          </button>

          <div className="sc-form-row sc-two-col" style={{ marginTop: 20 }}>
            <div>
              <label htmlFor="scContractTerms">Sales contract terms *</label>
              <select
                id="scContractTerms"
                required
                value={form.contractTerms}
                onChange={(e) => setField('contractTerms', e.target.value)}
              >
                <option value="">Select terms</option>
                {CONTRACT_TERMS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <div
                className={`sc-conditional${form.contractTerms === 'Custom' ? ' visible' : ''}`}
                id="scContractTermsCustomWrap"
                style={{ marginTop: 8 }}
              >
                <label htmlFor="scContractTermsCustom">Custom contract terms *</label>
                <textarea
                  id="scContractTermsCustom"
                  rows={2}
                  placeholder="Enter custom sales contract terms"
                  value={form.contractTermsCustom}
                  onChange={(e) => setField('contractTermsCustom', e.target.value)}
                />
              </div>
            </div>
            <div>
              <label htmlFor="scPaymentTerms">Payment terms *</label>
              <select
                id="scPaymentTerms"
                required
                value={form.paymentTerms}
                onChange={(e) => setField('paymentTerms', e.target.value)}
              >
                <option value="">Select payment terms</option>
                {PAYMENT_TERMS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <div
                className={`sc-conditional${form.paymentTerms === 'CAD' ? ' visible' : ''}`}
                id="scCadDaysWrap"
                style={{ marginTop: 8 }}
              >
                <label htmlFor="scCadDays">CAD — number of days *</label>
                <input
                  type="number"
                  id="scCadDays"
                  min={1}
                  step={1}
                  placeholder="e.g. 30"
                  value={form.cadDays}
                  onChange={(e) => setField('cadDays', e.target.value)}
                />
              </div>
              <div
                className={`sc-conditional${form.paymentTerms === 'Custom' ? ' visible' : ''}`}
                id="scPaymentTermsCustomWrap"
                style={{ marginTop: 8 }}
              >
                <label htmlFor="scPaymentTermsCustom">Custom payment terms *</label>
                <textarea
                  id="scPaymentTermsCustom"
                  rows={2}
                  placeholder="Enter custom payment terms"
                  value={form.paymentTermsCustom}
                  onChange={(e) => setField('paymentTermsCustom', e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="sc-form-row sc-two-col">
            <div>
              <label htmlFor="scDeliveryTime">Delivery time *</label>
              <input
                type="text"
                id="scDeliveryTime"
                required
                placeholder="e.g. 45 days from contract date"
                value={form.deliveryTime}
                onChange={(e) => setField('deliveryTime', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="scBrandName">Brand name (optional)</label>
              <input
                type="text"
                id="scBrandName"
                placeholder="Brand on documents"
                value={form.brandName}
                onChange={(e) => setField('brandName', e.target.value)}
              />
            </div>
          </div>

          <div className="sc-form-row sc-two-col">
            <div>
              <label htmlFor="scPortOfShipment">Port of shipment</label>
              <input
                type="text"
                id="scPortOfShipment"
                placeholder="e.g. Shanghai"
                value={form.portOfShipment}
                onChange={(e) => setField('portOfShipment', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="scPortOfDischarge">Port of discharge</label>
              <input
                type="text"
                id="scPortOfDischarge"
                placeholder="e.g. Karachi"
                value={form.portOfDischarge}
                onChange={(e) => setField('portOfDischarge', e.target.value)}
              />
            </div>
          </div>

          <div className="sc-form-row sc-two-col">
            <div>
              <label htmlFor="scSupplierCommission">Commission from supplier / MT</label>
              <input
                type="number"
                id="scSupplierCommission"
                min={0}
                step="any"
                placeholder="0"
                value={form.supplierCommissionPerMt}
                onChange={(e) => setField('supplierCommissionPerMt', e.target.value)}
              />
              <p className="form-hint" style={{ marginTop: 4 }}>
                Amount the supplier pays Tri Brothers (not paid to the supplier).
              </p>
              <p className="sc-commission-total" id="scSupplierCommissionTotal">
                Total from supplier:{' '}
                {toNum(form.supplierCommissionPerMt) > 0 && totalMt > 0
                  ? formatMoney(toNum(form.supplierCommissionPerMt) * totalMt, effectiveCommissionCurrency)
                  : '—'}
              </p>
            </div>
            <div>
              <label htmlFor="scSpecialInstructions">Special instructions</label>
              <textarea
                id="scSpecialInstructions"
                rows={3}
                placeholder="Optional notes"
                value={form.specialInstructions}
                onChange={(e) => setField('specialInstructions', e.target.value)}
              />
            </div>
          </div>

          <h3 className="product-form-section-title">Supplier bank details</h3>
          <p className="form-hint">
            Saved against this supplier and reused on the next contract. Change anytime — the new details are
            saved too.
          </p>
          <div className="sc-form-row">
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="scBankAccountSelect">Saved bank accounts</label>
              <select
                id="scBankAccountSelect"
                value={form.bankAccountId}
                onChange={(e) => onBankSelect(e.target.value)}
                disabled={!form.supplierId}
              >
                <option value="">New / enter manually</option>
                {banks.map((b) => (
                  <option key={idOf(b._id)} value={idOf(b._id)}>
                    {b.bankName || 'Bank'}
                    {b.accountNumber ? ` · ${b.accountNumber}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="sc-form-row sc-two-col">
            <div>
              <label htmlFor="scBankName">Bank name</label>
              <input
                type="text"
                id="scBankName"
                placeholder="Bank name"
                value={form.bankName}
                onChange={(e) => setField('bankName', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="scSwiftCode">SWIFT code</label>
              <input
                type="text"
                id="scSwiftCode"
                placeholder="SWIFT / BIC"
                value={form.swiftCode}
                onChange={(e) => setField('swiftCode', e.target.value)}
              />
            </div>
          </div>
          <div className="sc-form-row sc-two-col">
            <div>
              <label htmlFor="scAccountNumber">Account number</label>
              <input
                type="text"
                id="scAccountNumber"
                placeholder="Account number"
                value={form.accountNumber}
                onChange={(e) => setField('accountNumber', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="scBankAddress">Bank address</label>
              <input
                type="text"
                id="scBankAddress"
                placeholder="Bank address"
                value={form.bankAddress}
                onChange={(e) => setField('bankAddress', e.target.value)}
              />
            </div>
          </div>

          <div>
            <label htmlFor="scContractFile">Sales contract document</label>
            <input
              type="file"
              id="scContractFile"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp"
              onChange={(e) => setContractFile(e.target.files?.[0] || null)}
            />
            <p className="form-hint">Upload the signed sales contract file (PDF, Word, Excel, or image).</p>
            {editing?.contractFile ? (
              <p className="sc-spec-hint" id="scContractFileCurrent">
                Current file:{' '}
                <a href={uploadUrl(editing.contractFile)} target="_blank" rel="noopener noreferrer">
                  {editing.contractFile}
                </a>
                {!contractFile ? (
                  <label className="checkbox-row" style={{ marginTop: 6, display: 'flex' }}>
                    <input
                      type="checkbox"
                      checked={removeFile}
                      onChange={(e) => setRemoveFile(e.target.checked)}
                    />
                    Remove current file
                  </label>
                ) : null}
              </p>
            ) : null}
          </div>

          <div className="form-actions">
            <button type="submit" className="btn" id="scSubmitBtn" disabled={saving || !canEdit}>
              {saving ? 'Saving…' : 'Save sales contract'}
            </button>
            {editing ? (
              <button type="button" className="action-btn" id="scCancelEditBtn" disabled={saving} onClick={closeModal}>
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
              <th>Contract #</th>
              <th>Date</th>
              <th>Supplier</th>
              <th>Origin</th>
              <th>Products</th>
              <th>Remaining</th>
              <th>Contract value</th>
              <th>Shipment</th>
              <th>Terms</th>
              <th>Payment</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="scTableBody">
            {loading ? (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 16 }}>
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 16 }}>
                  {contracts.length ? 'No contracts match your search.' : 'No sales contracts yet.'}
                </td>
              </tr>
            ) : (
              filtered.map((c) => {
                const cur = c.priceCurrency || 'USD'
                const cls = contractLines(c)
                const total = cls.reduce((s, l) => s + toNum(l.quantity) * toNum(l.price), 0)
                return (
                  <tr key={c._id} className={highlightId === c._id ? 'row-highlight' : undefined}>
                    <td className="cell-nowrap">{c.contractNumber || '—'}</td>
                    <td className="cell-nowrap">{formatDate(c.contractDate)}</td>
                    <td>{supplierName(c)}</td>
                    <td>{c.originCountry || '—'}</td>
                    <td>
                      {cls.map((l, i) => (
                        <div key={l._id || i}>
                          {withDisplayName(
                            productName(l),
                            `${fmtQty(l.quantity)} ${l.quantityUnit || 'MT'} @ ${formatMoney(l.price, cur)}`,
                            ' ',
                          )}
                        </div>
                      ))}
                    </td>
                    <td>
                      {cls.map((l, i) => {
                        const rem =
                          l.remainingQuantity != null ? fmtQty(l.remainingQuantity) : fmtQty(l.quantity)
                        return (
                          <div key={l._id || `r-${i}`}>
                            {withDisplayName(productName(l), rem, ': ')}
                          </div>
                        )
                      })}
                    </td>
                    <td className="cell-nowrap">{formatMoney(total, cur)}</td>
                    <td className="cell-nowrap">{c.shipmentType || '—'}</td>
                    <td className="cell-nowrap">{formatTerms(c)}</td>
                    <td className="cell-nowrap">{formatPayment(c)}</td>
                    <td className="table-actions-cell cell-actions">
                      <RowActionsMenu
                        items={[
                          {
                            label: 'Contract file',
                            hidden: !c.contractFile,
                            onClick: () => window.open(uploadUrl(c.contractFile!), '_blank'),
                          },
                          {
                            label: 'Create indent',
                            href: `/indents?contract=${encodeURIComponent(c._id)}`,
                            hidden: !canEdit,
                          },
                          {
                            label: 'Edit',
                            hidden: !canEdit,
                            onClick: () => openEdit(c),
                          },
                          {
                            label: 'Delete',
                            danger: true,
                            hidden: !canDelete,
                            onClick: () => void handleDelete(c),
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
