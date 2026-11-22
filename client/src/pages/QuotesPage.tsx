import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useUrlSearch } from '@/hooks/useUrlSearch'
import { api, ApiError } from '@/api/client'
import { RowActionsMenu } from '@/components/RowActionsMenu'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { errorMessage, includesText, toNumber, unwrapList } from '@/lib/entity'
import { formatDate, idOf, nameOf } from '@/lib/utils'
import type { Client, Product, Supplier } from '@/types'

type Tab = 'quotations' | 'offers'

type SupplierProductLink = {
  _id: string
  productId?: Product | string | null
  supplierId?: Supplier | string | null
  supplierPrice?: number
  currency?: string
}

type OfferRow = {
  _id: string
  product?: Product | string | null
  supplier?: Supplier | string | null
  supplierProduct?: SupplierProductLink | string | null
  notes?: string
  receivedPrice?: number | null
  createdAt?: string
}

type QuotationRow = {
  _id: string
  product?: Product | string | null
  client?: Client | string | null
  supplierProduct?: SupplierProductLink | string | null
  offer?: OfferRow | string | null
  baseCost?: number | null
  margin?: number | null
  finalPrice?: number | null
  price?: number | null
  hsCode?: string
  duties?: string
  notes?: string
  createdAt?: string
}

type QForm = {
  productId: string
  clientIds: string[]
  supplierProductId: string
  offerId: string
  baseCost: string
  finalPrice: string
  hsCode: string
  duties: string
  sendEmail: boolean
}

type OForm = {
  productId: string
  supplierId: string
  notes: string
}

type NcForm = {
  companyName: string
  contactPersons: string
  address: string
  postCode: string
  city: string
  province: string
  country: string
  tel: string
  mobile: string
  email: string
  web: string
  wechat: string
  facebook: string
  whatsapp: string
  others: string
}

const EMPTY_Q: QForm = {
  productId: '',
  clientIds: [],
  supplierProductId: '',
  offerId: '',
  baseCost: '',
  finalPrice: '',
  hsCode: '',
  duties: '',
  sendEmail: true,
}

const EMPTY_O: OForm = { productId: '', supplierId: '', notes: '' }

const EMPTY_NC: NcForm = {
  companyName: '',
  contactPersons: '',
  address: '',
  postCode: '',
  city: '',
  province: '',
  country: '',
  tel: '',
  mobile: '',
  email: '',
  web: '',
  wechat: '',
  facebook: '',
  whatsapp: '',
  others: '',
}

const IconPlus = () => (
  <span className="icon" aria-hidden="true">
    <svg viewBox="0 0 24 24">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  </span>
)

const IconClose = () => (
  <span className="icon" aria-hidden="true">
    <svg viewBox="0 0 24 24">
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  </span>
)

function calcMarginDisplay(baseCost: string, finalPrice: string): string {
  const base = parseFloat(baseCost)
  const final = parseFloat(finalPrice)
  if (!isNaN(base) && base > 0 && !isNaN(final)) {
    return (((final - base) / base) * 100).toFixed(2) + '%'
  }
  return ''
}

export default function QuotesPage() {
  useEffect(() => {
    document.title = 'Quotations & Offers | TRI Dashboard'
  }, [])

  const { canEdit, canDelete, canEmail } = useAuth()
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const [tab, setTab] = useState<Tab>(searchParams.get('tab') === 'offers' ? 'offers' : 'quotations')

  const [quotations, setQuotations] = useState<QuotationRow[]>([])
  const [offers, setOffers] = useState<OfferRow[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)

  const { search, setSearch } = useUrlSearch()
  const [offerSearch, setOfferSearch] = useState('')

  const [qOpen, setQOpen] = useState(false)
  const [qForm, setQForm] = useState<QForm>(EMPTY_Q)
  const [spLinks, setSpLinks] = useState<SupplierProductLink[]>([])
  const [clientSearch, setClientSearch] = useState('')
  const [qSaving, setQSaving] = useState(false)

  const [oOpen, setOOpen] = useState(false)
  const [oForm, setOForm] = useState<OForm>(EMPTY_O)
  const [oSaving, setOSaving] = useState(false)

  const [ncOpen, setNcOpen] = useState(false)
  const [ncForm, setNcForm] = useState<NcForm>(EMPTY_NC)
  const [ncSaving, setNcSaving] = useState(false)

  // inline row edit state
  const [qEditId, setQEditId] = useState<string | null>(null)
  const [qEditDraft, setQEditDraft] = useState({
    baseCost: '',
    margin: '',
    finalPrice: '',
    hsCode: '',
    duties: '',
  })
  const [oEditId, setOEditId] = useState<string | null>(null)
  const [oEditDraft, setOEditDraft] = useState({ notes: '', receivedPrice: '' })

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [q, o, p, c, s] = await Promise.all([
        api<unknown>('/api/quotations'),
        api<unknown>('/api/offers'),
        api<unknown>('/api/products'),
        api<unknown>('/api/clients'),
        api<unknown>('/api/suppliers'),
      ])
      setQuotations(unwrapList<QuotationRow>(q))
      setOffers(unwrapList<OfferRow>(o))
      setProducts(unwrapList<Product>(p))
      setClients(unwrapList<Client>(c))
      setSuppliers(unwrapList<Supplier>(s))
    } catch (err) {
      toast(errorMessage(err, 'Failed to load quotes'), 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  function switchTab(next: Tab) {
    setTab(next)
    setSearch('')
    setOfferSearch('')
    if (next === 'quotations') setOOpen(false)
    else setQOpen(false)
    const params = new URLSearchParams(searchParams)
    if (next === 'offers') params.set('tab', 'offers')
    else params.delete('tab')
    setSearchParams(params, { replace: true })
  }

  const productMap = useMemo(() => new Map(products.map((p) => [p._id, p])), [products])

  useEffect(() => {
    if (!qOpen || !qForm.productId) {
      setSpLinks([])
      return
    }
    let cancelled = false
    api<SupplierProductLink[]>(`/api/supplier-products?productId=${encodeURIComponent(qForm.productId)}`)
      .then((data) => {
        if (!cancelled) setSpLinks(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        if (!cancelled) setSpLinks([])
      })
    return () => {
      cancelled = true
    }
  }, [qOpen, qForm.productId])

  const offersForProduct = useMemo(
    () => offers.filter((o) => !qForm.productId || idOf(o.product) === qForm.productId),
    [offers, qForm.productId],
  )

  const openQuoteCreate = useCallback(
    (prefill: Partial<QForm> = {}) => {
      const product = prefill.productId ? productMap.get(prefill.productId) : undefined
      setQForm({
        ...EMPTY_Q,
        hsCode: product?.hsCode || '',
        sendEmail: canEmail,
        ...prefill,
      })
      setClientSearch('')
      setQOpen(true)
      setOOpen(false)
      setTab('quotations')
    },
    [productMap, canEmail],
  )

  useEffect(() => {
    if (loading || searchParams.get('new') !== '1') return
    if (canEdit) {
      const prefill: Partial<QForm> = {}
      const productId = searchParams.get('productId')
      const clientId = searchParams.get('clientId')
      const offerId = searchParams.get('offerId')
      if (productId) prefill.productId = productId
      if (clientId) prefill.clientIds = [clientId]
      if (offerId) {
        const offer = offers.find((o) => o._id === offerId)
        if (offer) {
          prefill.offerId = offerId
          prefill.productId = idOf(offer.product)
          prefill.supplierProductId = idOf(offer.supplierProduct)
          if (offer.receivedPrice != null) prefill.baseCost = String(offer.receivedPrice)
        }
      }
      openQuoteCreate(prefill)
    }
    const next = new URLSearchParams(searchParams)
    ;['new', 'productId', 'clientId', 'offerId'].forEach((k) => next.delete(k))
    setSearchParams(next, { replace: true })
  }, [loading, searchParams, canEdit, offers, openQuoteCreate, setSearchParams])

  function onProductChange(productId: string) {
    const product = productMap.get(productId)
    setQForm((f) => ({
      ...f,
      productId,
      supplierProductId: '',
      offerId: '',
      hsCode: product?.hsCode || f.hsCode,
    }))
  }

  function onOfferChange(id: string) {
    const offer = offers.find((o) => o._id === id)
    setQForm((f) => {
      const next = { ...f, offerId: id }
      if (offer?.receivedPrice != null) next.baseCost = String(offer.receivedPrice)
      else if (!id) next.baseCost = ''
      return next
    })
  }

  function toggleClient(id: string) {
    setQForm((f) => ({
      ...f,
      clientIds: f.clientIds.includes(id) ? f.clientIds.filter((x) => x !== id) : [...f.clientIds, id],
    }))
  }

  const visibleClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase()
    return clients.filter((c) => !q || (c.companyName || '').toLowerCase().includes(q))
  }, [clients, clientSearch])

  const allVisibleSelected =
    visibleClients.length > 0 && visibleClients.every((c) => qForm.clientIds.includes(c._id))
  const someVisibleSelected = visibleClients.some((c) => qForm.clientIds.includes(c._id))

  function toggleSelectAllClients() {
    const ids = visibleClients.map((c) => c._id)
    setQForm((f) => ({
      ...f,
      clientIds: allVisibleSelected
        ? f.clientIds.filter((id) => !ids.includes(id))
        : [...new Set([...f.clientIds, ...ids])],
    }))
  }

  const marginDisplay = calcMarginDisplay(qForm.baseCost, qForm.finalPrice)

  async function onQuoteSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canEdit) return
    const finalPrice = toNumber(qForm.finalPrice)
    if (!qForm.productId) return toast('Select a product', 'error')
    if (!qForm.clientIds.length) return toast('Select at least one client', 'error')
    if (finalPrice == null) return toast('Final price is required', 'error')

    const marginNum = marginDisplay ? parseFloat(marginDisplay.replace('%', '')) : undefined

    setQSaving(true)
    try {
      const res = await api<{ message?: string }>('/api/quotations', {
        method: 'POST',
        body: JSON.stringify({
          productId: qForm.productId,
          clientIds: qForm.clientIds,
          supplierProductId: qForm.supplierProductId || undefined,
          offerId: qForm.offerId || undefined,
          baseCost: qForm.baseCost === '' ? undefined : Number(qForm.baseCost),
          margin: marginNum,
          finalPrice,
          hsCode: qForm.hsCode.trim() || undefined,
          duties: qForm.duties.trim() || undefined,
          sendEmail: canEmail && qForm.sendEmail,
        }),
      })
      toast(res?.message?.replace(/^✅\s*/, '') || 'Quotation(s) created', 'success')
      setQForm({ ...EMPTY_Q, sendEmail: canEmail })
      setClientSearch('')
      setSpLinks([])
      setQOpen(false)
      await loadAll()
    } catch (err) {
      toast(errorMessage(err, 'Failed to save quotation'), 'error')
    } finally {
      setQSaving(false)
    }
  }

  async function saveQuoteInline(id: string) {
    try {
      await api(`/api/quotations/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          baseCost: qEditDraft.baseCost ? parseFloat(qEditDraft.baseCost) : undefined,
          margin: qEditDraft.margin
            ? parseFloat(String(qEditDraft.margin).replace('%', ''))
            : undefined,
          finalPrice: parseFloat(qEditDraft.finalPrice) || 0,
          hsCode: qEditDraft.hsCode || undefined,
          duties: qEditDraft.duties || undefined,
        }),
      })
      toast('Quotation updated', 'success')
      setQEditId(null)
      await loadAll()
    } catch (err) {
      toast(errorMessage(err, 'Failed to update quotation'), 'error')
    }
  }

  async function onQuoteDelete(q: QuotationRow) {
    if (!window.confirm('Delete this quotation?')) return
    try {
      await api(`/api/quotations/${q._id}`, { method: 'DELETE' })
      toast('Quotation deleted', 'success')
      await loadAll()
    } catch (err) {
      toast(errorMessage(err, 'Delete failed'), 'error')
    }
  }

  function openOfferCreate() {
    setOForm(EMPTY_O)
    setOOpen(true)
    setTab('offers')
    setQOpen(false)
  }

  async function onOfferSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canEdit) return
    if (!oForm.productId || !oForm.supplierId) return toast('Product and supplier are required', 'error')
    setOSaving(true)
    try {
      const res = await api<{ message?: string }>('/api/offers', {
        method: 'POST',
        body: JSON.stringify({
          productId: oForm.productId,
          supplierId: oForm.supplierId,
          notes: oForm.notes.trim() || undefined,
        }),
      })
      toast(res?.message?.replace(/^✅\s*/, '') || 'Offer request created', 'success')
      setOForm(EMPTY_O)
      setOOpen(false)
      await loadAll()
    } catch (err) {
      toast(errorMessage(err, 'Failed to save offer'), 'error')
    } finally {
      setOSaving(false)
    }
  }

  async function saveOfferInline(id: string) {
    try {
      await api(`/api/offers/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          notes: oEditDraft.notes,
          receivedPrice: oEditDraft.receivedPrice === '' ? '' : parseFloat(oEditDraft.receivedPrice),
        }),
      })
      toast('Offer updated', 'success')
      setOEditId(null)
      await loadAll()
    } catch (err) {
      toast(errorMessage(err, 'Failed to update offer'), 'error')
    }
  }

  async function onOfferDelete(o: OfferRow) {
    if (!window.confirm('Delete this offer?')) return
    try {
      await api(`/api/offers/${o._id}`, { method: 'DELETE' })
      toast('Offer deleted', 'success')
      await loadAll()
    } catch (err) {
      toast(errorMessage(err, 'Delete failed'), 'error')
    }
  }

  async function addQuickSupplier() {
    const companyName = window.prompt('New supplier – Company name:')
    if (!companyName?.trim()) return
    const email = window.prompt('Contact email (optional):') || ''
    try {
      const data = await api<{ supplier?: Supplier; existingId?: string; error?: string }>(
        '/api/suppliers',
        {
          method: 'POST',
          body: JSON.stringify({
            companyName: companyName.trim(),
            contactPersons: JSON.stringify([{ name: '', email: email.trim() }]),
            skipDuplicateCheck: false,
          }),
        },
      )
      if (data.supplier) {
        setSuppliers((prev) => [...prev, data.supplier!])
        setOForm((f) => ({ ...f, supplierId: data.supplier!._id }))
        toast('Supplier added and selected.', 'success')
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const existingId = (err.data as { existingId?: string } | undefined)?.existingId
        toast('A supplier with this name already exists. Select it from the list.', 'error')
        if (existingId) setOForm((f) => ({ ...f, supplierId: existingId }))
        return
      }
      toast(errorMessage(err, 'Failed to add supplier'), 'error')
    }
  }

  async function onNewClientSubmit(e: FormEvent) {
    e.preventDefault()
    if (!ncForm.companyName.trim() || !ncForm.email.trim()) {
      return toast('Company name and email are required', 'error')
    }
    setNcSaving(true)
    const contactPersons = ncForm.contactPersons
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    const payload = {
      companyName: ncForm.companyName.trim(),
      contactPersons: JSON.stringify(contactPersons),
      address: ncForm.address.trim(),
      postCode: ncForm.postCode.trim(),
      city: ncForm.city.trim(),
      province: ncForm.province.trim(),
      country: ncForm.country.trim(),
      tel: ncForm.tel.trim(),
      mobile: ncForm.mobile.trim(),
      email: ncForm.email.trim(),
      web: ncForm.web.trim(),
      wechat: ncForm.wechat.trim(),
      facebook: ncForm.facebook.trim(),
      whatsapp: ncForm.whatsapp.trim(),
      others: ncForm.others.trim(),
      skipDuplicateCheck: false,
    }
    try {
      const data = await api<{ client?: Client; existingId?: string }>('/api/clients', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      if (data.client) {
        setClients((prev) => [...prev, data.client!])
        setQForm((f) => ({ ...f, clientIds: [...new Set([...f.clientIds, data.client!._id])] }))
        toast('Client added and selected.', 'success')
      }
      setNcOpen(false)
      setNcForm(EMPTY_NC)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const existingId = (err.data as { existingId?: string } | undefined)?.existingId
        toast('A client with this company name already exists. Select it from the list.', 'error')
        if (existingId) {
          setQForm((f) => ({ ...f, clientIds: [...new Set([...f.clientIds, existingId])] }))
          if (!clients.some((c) => c._id === existingId)) {
            setClients((prev) => [...prev, { _id: existingId, companyName: payload.companyName } as Client])
          }
        }
        setNcOpen(false)
        return
      }
      toast(errorMessage(err, 'Failed to add client'), 'error')
    } finally {
      setNcSaving(false)
    }
  }

  const filteredQuotes = useMemo(
    () =>
      quotations.filter((q) =>
        includesText(
          [
            nameOf(q.product),
            nameOf(q.client),
            q.hsCode,
            q.duties,
            nameOf(typeof q.offer === 'object' ? q.offer?.supplier : null),
          ],
          search,
        ),
      ),
    [quotations, search],
  )

  const filteredOffers = useMemo(
    () =>
      offers.filter((o) => includesText([nameOf(o.product), nameOf(o.supplier), o.notes], offerSearch)),
    [offers, offerSearch],
  )

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Sales</p>
          <h1>Quotations &amp; Offers</h1>
        </div>
      </header>

      <div className="tabs">
        <button
          type="button"
          className={`tab tab-btn${tab === 'quotations' ? ' active' : ''}`}
          onClick={() => switchTab('quotations')}
        >
          Quotations
        </button>
        <button
          type="button"
          className={`tab tab-btn${tab === 'offers' ? ' active' : ''}`}
          onClick={() => switchTab('offers')}
        >
          Offers
        </button>
      </div>

      {/* QUOTATIONS SECTION */}
      <div id="quotationsSection" className={`section${tab === 'quotations' ? ' active' : ''}`}>
        <div className="products-toolbar list-toolbar">
          <div className="toolbar-row">
            <div className="toolbar-group toolbar-search">
              <label htmlFor="quotationSearch">Search</label>
              <input
                type="search"
                id="quotationSearch"
                placeholder="Product, client, HS code, duties…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {canEdit ? (
              <div className="toolbar-actions">
                <button
                  type="button"
                  className="btn toolbar-cta"
                  id="toggleQuoteFormBtn"
                  onClick={() => {
                    if (qOpen) setQOpen(false)
                    else openQuoteCreate()
                  }}
                >
                  {qOpen ? 'Close form' : 'New quotation'}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div
          className={`form-container${qOpen ? ' show' : ' is-collapsed'}`}
          id="quotationFormWrap"
        >
          <h2 style={{ marginBottom: 12 }}>Create Quotation</h2>
          <form id="quotationForm" onSubmit={onQuoteSubmit}>
            <div className="form-row">
              <div>
                <label>Product</label>
                <select
                  id="quotationProduct"
                  required
                  value={qForm.productId}
                  onChange={(e) => onProductChange(e.target.value)}
                >
                  <option value="">Select product</option>
                  {products.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="quotation-client-box">
                <label>Client(s) – select one or more</label>
                <input
                  type="text"
                  id="quotationClientSearch"
                  className="quotation-client-search"
                  placeholder="Search clients…"
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                />
                <div className="client-select-wrap" id="quotationClientWrap">
                  <div className="select-all-row">
                    <input
                      type="checkbox"
                      id="quotationSelectAllClients"
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected
                      }}
                      onChange={toggleSelectAllClients}
                    />
                    <label htmlFor="quotationSelectAllClients">Select all clients</label>
                  </div>
                  <div id="quotationClientCheckboxes">
                    {clients.map((c) => {
                      const hidden =
                        clientSearch.trim() !== '' &&
                        !(c.companyName || '').toLowerCase().includes(clientSearch.trim().toLowerCase())
                      return (
                        <div
                          key={c._id}
                          className={`client-checkbox-item${hidden ? ' quotation-client-hidden' : ''}`}
                        >
                          <input
                            type="checkbox"
                            id={`client-cb-${c._id}`}
                            className="quotation-client-cb"
                            checked={qForm.clientIds.includes(c._id)}
                            onChange={() => toggleClient(c._id)}
                          />
                          <label htmlFor={`client-cb-${c._id}`}>{c.companyName}</label>
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div className="client-actions">
                  {canEdit ? (
                    <button
                      type="button"
                      className="action-btn"
                      id="addNewClientBtn"
                      title="Add new client (full details)"
                      onClick={() => {
                        setNcForm(EMPTY_NC)
                        setNcOpen(true)
                      }}
                    >
                      <IconPlus />
                      New client
                    </button>
                  ) : null}
                </div>
              </div>
              <div>
                <label>Link to Offer (optional)</label>
                <select
                  id="quotationOffer"
                  value={qForm.offerId}
                  onChange={(e) => onOfferChange(e.target.value)}
                >
                  <option value="">None</option>
                  {offersForProduct.map((o) => (
                    <option key={o._id} value={o._id}>
                      {nameOf(o.supplier)} – {nameOf(o.product)} ({formatDate(o.createdAt)})
                    </option>
                  ))}
                </select>
                <small style={{ color: '#888', display: 'block', marginTop: 4 }}>
                  Link to a supplier offer for reference
                </small>
              </div>
            </div>
            <div className="form-row" style={{ marginTop: 16 }}>
              <div>
                <label>Supplier–Product (optional cost reference)</label>
                <select
                  id="quotationSupplierProduct"
                  value={qForm.supplierProductId}
                  onChange={(e) => {
                    const id = e.target.value
                    const link = spLinks.find((l) => l._id === id)
                    setQForm((f) => ({
                      ...f,
                      supplierProductId: id,
                      baseCost:
                        link?.supplierPrice != null && !f.baseCost
                          ? String(link.supplierPrice)
                          : f.baseCost,
                    }))
                  }}
                  disabled={!qForm.productId}
                >
                  <option value="">None</option>
                  {spLinks.map((l) => (
                    <option key={l._id} value={l._id}>
                      {nameOf(l.supplierId)} – {l.supplierPrice ?? ''} {l.currency || ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Base cost (reference)</label>
                <input
                  type="number"
                  id="quotationBaseCost"
                  step="0.01"
                  placeholder="Optional"
                  value={qForm.baseCost}
                  onChange={(e) => setQForm({ ...qForm, baseCost: e.target.value })}
                />
              </div>
              <div>
                <label>Final price</label>
                <input
                  type="number"
                  id="quotationFinalPrice"
                  required
                  step="0.01"
                  value={qForm.finalPrice}
                  onChange={(e) => setQForm({ ...qForm, finalPrice: e.target.value })}
                />
              </div>
              <div>
                <label>Margin (%) – auto-calculated</label>
                <input
                  type="text"
                  id="quotationMargin"
                  readOnly
                  placeholder="—"
                  className="input-readonly"
                  value={marginDisplay}
                />
              </div>
            </div>
            <div className="form-row" style={{ marginTop: 16 }}>
              <div>
                <label>HS Code</label>
                <input
                  type="text"
                  id="quotationHsCode"
                  placeholder="Auto-filled from product if empty"
                  value={qForm.hsCode}
                  onChange={(e) => setQForm({ ...qForm, hsCode: e.target.value })}
                />
              </div>
              <div>
                <label>Duties</label>
                <input
                  type="text"
                  id="quotationDuties"
                  placeholder="e.g. Import 5%, Sales 10%"
                  value={qForm.duties}
                  onChange={(e) => setQForm({ ...qForm, duties: e.target.value })}
                />
              </div>
            </div>
            {canEmail ? (
              <div className="email-check-row">
                <input
                  type="checkbox"
                  id="quotationSendEmail"
                  checked={qForm.sendEmail}
                  onChange={(e) => setQForm({ ...qForm, sendEmail: e.target.checked })}
                />
                <label htmlFor="quotationSendEmail">Email quotation to selected client(s)</label>
              </div>
            ) : null}
            <button type="submit" className="btn" id="sendQuotationBtn" disabled={qSaving || !canEdit}>
              {qSaving ? 'Saving…' : 'Save Quotation'}
            </button>
          </form>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Client</th>
                <th>Base cost</th>
                <th>Margin</th>
                <th>Final price</th>
                <th>HS Code</th>
                <th>Duties</th>
                <th>Linked offer</th>
                <th>Created At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="quotationsTableBody">
              {loading ? (
                <tr>
                  <td colSpan={10}>Loading…</td>
                </tr>
              ) : filteredQuotes.length === 0 ? (
                <tr>
                  <td colSpan={10}>{quotations.length === 0 ? 'No quotations yet.' : 'No match.'}</td>
                </tr>
              ) : (
                filteredQuotes.map((q) => {
                  const editing = qEditId === q._id
                  const offer = typeof q.offer === 'object' ? q.offer : null
                  const fp = q.finalPrice ?? q.price
                  return (
                    <tr key={q._id}>
                      <td>{nameOf(q.product)}</td>
                      <td>{nameOf(q.client)}</td>
                      <td
                        contentEditable={editing}
                        suppressContentEditableWarning
                        style={
                          editing
                            ? { backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)' }
                            : undefined
                        }
                        onBlur={(e) =>
                          editing &&
                          setQEditDraft((d) => ({ ...d, baseCost: e.currentTarget.textContent || '' }))
                        }
                      >
                        {editing ? qEditDraft.baseCost : (q.baseCost ?? '')}
                      </td>
                      <td
                        contentEditable={editing}
                        suppressContentEditableWarning
                        style={
                          editing
                            ? { backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)' }
                            : undefined
                        }
                        onBlur={(e) =>
                          editing &&
                          setQEditDraft((d) => ({ ...d, margin: e.currentTarget.textContent || '' }))
                        }
                      >
                        {editing ? qEditDraft.margin : (q.margin ?? '')}
                      </td>
                      <td
                        contentEditable={editing}
                        suppressContentEditableWarning
                        style={
                          editing
                            ? { backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)' }
                            : undefined
                        }
                        onBlur={(e) =>
                          editing &&
                          setQEditDraft((d) => ({
                            ...d,
                            finalPrice: e.currentTarget.textContent || '',
                          }))
                        }
                      >
                        {editing ? qEditDraft.finalPrice : (fp ?? '')}
                      </td>
                      <td
                        contentEditable={editing}
                        suppressContentEditableWarning
                        style={
                          editing
                            ? { backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)' }
                            : undefined
                        }
                        onBlur={(e) =>
                          editing &&
                          setQEditDraft((d) => ({ ...d, hsCode: e.currentTarget.textContent || '' }))
                        }
                      >
                        {editing ? qEditDraft.hsCode : q.hsCode || ''}
                      </td>
                      <td
                        contentEditable={editing}
                        suppressContentEditableWarning
                        style={
                          editing
                            ? { backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)' }
                            : undefined
                        }
                        onBlur={(e) =>
                          editing &&
                          setQEditDraft((d) => ({ ...d, duties: e.currentTarget.textContent || '' }))
                        }
                      >
                        {editing ? qEditDraft.duties : q.duties || ''}
                      </td>
                      <td>{offer ? nameOf(offer.supplier) || 'Offer' : ''}</td>
                      <td>{q.createdAt ? new Date(q.createdAt).toLocaleString() : ''}</td>
                      <td className="table-actions-cell">
                        {editing ? (
                          <button
                            type="button"
                            className="action-btn quotation-save"
                            onClick={() => void saveQuoteInline(q._id)}
                          >
                            Save
                          </button>
                        ) : (
                          <RowActionsMenu
                            items={[
                              {
                                label: 'PDF',
                                onClick: () => window.open(`/api/quotations/${q._id}/pdf`, '_blank'),
                              },
                              {
                                label: 'Edit',
                                hidden: !canEdit,
                                onClick: () => {
                                  setQEditId(q._id)
                                  setQEditDraft({
                                    baseCost: q.baseCost != null ? String(q.baseCost) : '',
                                    margin: q.margin != null ? String(q.margin) : '',
                                    finalPrice: fp != null ? String(fp) : '',
                                    hsCode: q.hsCode || '',
                                    duties: q.duties || '',
                                  })
                                },
                              },
                              {
                                label: 'Delete',
                                danger: true,
                                hidden: !canDelete,
                                onClick: () => void onQuoteDelete(q),
                              },
                            ]}
                          />
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add new client modal */}
      {ncOpen ? (
        <div id="newClientModal" className="view-modal-overlay" style={{ display: 'flex' }}>
          <div className="view-modal-box">
            <div className="view-modal-header">
              <h3>Add new client</h3>
              <button
                type="button"
                className="btn"
                id="newClientModalClose"
                onClick={() => !ncSaving && setNcOpen(false)}
              >
                <IconClose />
                Close
              </button>
            </div>
            <form id="newClientForm" className="view-modal-body" onSubmit={onNewClientSubmit}>
              <label>Company name *</label>
              <input
                type="text"
                id="ncCompanyName"
                required
                value={ncForm.companyName}
                onChange={(e) => setNcForm({ ...ncForm, companyName: e.target.value })}
              />
              <label>Contact person(s) – one per line</label>
              <textarea
                id="ncContactPersons"
                style={{ minHeight: 50 }}
                value={ncForm.contactPersons}
                onChange={(e) => setNcForm({ ...ncForm, contactPersons: e.target.value })}
              />
              <label>Address</label>
              <input
                type="text"
                id="ncAddress"
                value={ncForm.address}
                onChange={(e) => setNcForm({ ...ncForm, address: e.target.value })}
              />
              <div className="form-row">
                <div>
                  <label>Post code</label>
                  <input
                    type="text"
                    id="ncPostCode"
                    value={ncForm.postCode}
                    onChange={(e) => setNcForm({ ...ncForm, postCode: e.target.value })}
                  />
                </div>
                <div>
                  <label>City</label>
                  <input
                    type="text"
                    id="ncCity"
                    value={ncForm.city}
                    onChange={(e) => setNcForm({ ...ncForm, city: e.target.value })}
                  />
                </div>
                <div>
                  <label>Province</label>
                  <input
                    type="text"
                    id="ncProvince"
                    value={ncForm.province}
                    onChange={(e) => setNcForm({ ...ncForm, province: e.target.value })}
                  />
                </div>
                <div>
                  <label>Country</label>
                  <input
                    type="text"
                    id="ncCountry"
                    value={ncForm.country}
                    onChange={(e) => setNcForm({ ...ncForm, country: e.target.value })}
                  />
                </div>
              </div>
              <label>Tel</label>
              <input
                type="text"
                id="ncTel"
                value={ncForm.tel}
                onChange={(e) => setNcForm({ ...ncForm, tel: e.target.value })}
              />
              <label>Mobile</label>
              <input
                type="text"
                id="ncMobile"
                value={ncForm.mobile}
                onChange={(e) => setNcForm({ ...ncForm, mobile: e.target.value })}
              />
              <label>Email *</label>
              <input
                type="email"
                id="ncEmail"
                required
                value={ncForm.email}
                onChange={(e) => setNcForm({ ...ncForm, email: e.target.value })}
              />
              <label>Web</label>
              <input
                type="text"
                id="ncWeb"
                value={ncForm.web}
                onChange={(e) => setNcForm({ ...ncForm, web: e.target.value })}
              />
              <label>WeChat / Facebook / Whatsapp / Others</label>
              <input
                type="text"
                id="ncWechat"
                placeholder="WeChat"
                value={ncForm.wechat}
                onChange={(e) => setNcForm({ ...ncForm, wechat: e.target.value })}
              />
              <input
                type="text"
                id="ncFacebook"
                placeholder="Facebook"
                value={ncForm.facebook}
                onChange={(e) => setNcForm({ ...ncForm, facebook: e.target.value })}
              />
              <input
                type="text"
                id="ncWhatsapp"
                placeholder="Whatsapp"
                value={ncForm.whatsapp}
                onChange={(e) => setNcForm({ ...ncForm, whatsapp: e.target.value })}
              />
              <textarea
                id="ncOthers"
                placeholder="Others"
                style={{ minHeight: 40 }}
                value={ncForm.others}
                onChange={(e) => setNcForm({ ...ncForm, others: e.target.value })}
              />
              <div className="view-modal-btn-group" style={{ marginTop: 12 }}>
                <button type="submit" className="btn" disabled={ncSaving}>
                  {ncSaving ? 'Saving…' : 'Add client & select'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* OFFERS SECTION */}
      <div id="offersSection" className={`section${tab === 'offers' ? ' active' : ''}`}>
        <div className="products-toolbar list-toolbar">
          <div className="toolbar-row">
            <div className="toolbar-group toolbar-search">
              <label htmlFor="offerSearch">Search</label>
              <input
                type="search"
                id="offerSearch"
                placeholder="Product, supplier, notes…"
                value={offerSearch}
                onChange={(e) => setOfferSearch(e.target.value)}
              />
            </div>
            {canEdit ? (
              <div className="toolbar-actions">
                <button
                  type="button"
                  className="btn toolbar-cta"
                  id="toggleOfferFormBtn"
                  onClick={() => {
                    if (oOpen) setOOpen(false)
                    else openOfferCreate()
                  }}
                >
                  {oOpen ? 'Close form' : 'New offer'}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className={`form-container${oOpen ? ' show' : ' is-collapsed'}`} id="offerFormWrap">
          <h2 style={{ marginBottom: 12 }}>Request Offer</h2>
          <form id="offerForm" onSubmit={onOfferSubmit}>
            <div className="form-row">
              <div>
                <label>Product</label>
                <select
                  id="offerProduct"
                  required
                  value={oForm.productId}
                  onChange={(e) => setOForm({ ...oForm, productId: e.target.value })}
                >
                  <option value="">Select product</option>
                  {products.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Supplier</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    id="offerSupplier"
                    required
                    style={{ flex: 1 }}
                    value={oForm.supplierId}
                    onChange={(e) => setOForm({ ...oForm, supplierId: e.target.value })}
                  >
                    <option value="">Select supplier</option>
                    {suppliers.map((s) => (
                      <option key={s._id} value={s._id}>
                        {s.companyName}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="action-btn"
                    id="addNewSupplierBtn"
                    title="Add new supplier"
                    onClick={() => void addQuickSupplier()}
                  >
                    <IconPlus />
                    New
                  </button>
                </div>
              </div>
            </div>
            <div className="form-row" style={{ marginTop: 16 }}>
              <div>
                <label>Notes / Requirements</label>
                <textarea
                  id="offerNotes"
                  placeholder="Add any specific requirements or notes for this offer request"
                  value={oForm.notes}
                  onChange={(e) => setOForm({ ...oForm, notes: e.target.value })}
                />
              </div>
            </div>
            <button type="submit" className="btn" id="sendOfferBtn" disabled={oSaving || !canEdit}>
              {oSaving ? 'Saving…' : 'Request Offer'}
            </button>
          </form>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Supplier</th>
                <th>Notes</th>
                <th>Received price</th>
                <th>Created At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="offersTableBody">
              {loading ? (
                <tr>
                  <td colSpan={6}>Loading…</td>
                </tr>
              ) : filteredOffers.length === 0 ? (
                <tr>
                  <td colSpan={6}>{offers.length === 0 ? 'No offers yet.' : 'No match.'}</td>
                </tr>
              ) : (
                filteredOffers.map((o) => {
                  const editing = oEditId === o._id
                  return (
                    <tr key={o._id}>
                      <td>{nameOf(o.product)}</td>
                      <td>{nameOf(o.supplier)}</td>
                      <td
                        contentEditable={editing}
                        suppressContentEditableWarning
                        style={
                          editing
                            ? { backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)' }
                            : undefined
                        }
                        onBlur={(e) =>
                          editing &&
                          setOEditDraft((d) => ({ ...d, notes: e.currentTarget.textContent || '' }))
                        }
                      >
                        {editing ? oEditDraft.notes : o.notes || ''}
                      </td>
                      <td
                        contentEditable={editing}
                        suppressContentEditableWarning
                        style={
                          editing
                            ? { backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)' }
                            : undefined
                        }
                        onBlur={(e) =>
                          editing &&
                          setOEditDraft((d) => ({
                            ...d,
                            receivedPrice: e.currentTarget.textContent || '',
                          }))
                        }
                      >
                        {editing
                          ? oEditDraft.receivedPrice
                          : o.receivedPrice != null
                            ? String(o.receivedPrice)
                            : ''}
                      </td>
                      <td>{o.createdAt ? new Date(o.createdAt).toLocaleString() : ''}</td>
                      <td className="table-actions-cell">
                        {editing ? (
                          <button
                            type="button"
                            className="action-btn offer-save"
                            onClick={() => void saveOfferInline(o._id)}
                          >
                            Save
                          </button>
                        ) : (
                          <RowActionsMenu
                            items={[
                              {
                                label: 'Edit',
                                hidden: !canEdit,
                                onClick: () => {
                                  setOEditId(o._id)
                                  setOEditDraft({
                                    notes: o.notes || '',
                                    receivedPrice:
                                      o.receivedPrice != null ? String(o.receivedPrice) : '',
                                  })
                                },
                              },
                              {
                                label: 'Delete',
                                danger: true,
                                hidden: !canDelete,
                                onClick: () => void onOfferDelete(o),
                              },
                            ]}
                          />
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
