import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useUrlSearch } from '@/hooks/useUrlSearch'
import { api, apiForm, ApiError } from '@/api/client'
import { ContactsEditor, emptyContact } from '@/components/ContactsEditor'
import { CountryPicker } from '@/components/CountryPicker'
import {
  ProductAttachmentDrafts,
  type DraftProductLink,
} from '@/components/EntityLinkDrafts'
import { EntityImportPanel } from '@/components/EntityImportPanel'
import { RowActionsMenu } from '@/components/RowActionsMenu'
import { Info } from '@/components/ui/Info'
import { Modal } from '@/components/ui/Modal'
import { SortTh } from '@/components/ui/SortTh'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useSort } from '@/hooks/useSort'
import { useSelection } from '@/hooks/useSelection'
import { applyDialToContactPhones } from '@/lib/countries'
import {
  cleanContacts,
  compareValues,
  contactSearchBlob,
  contactsSummary,
  displayFileName,
  errorMessage,
  includesText,
  unwrapList,
  uploadUrl,
} from '@/lib/entity'
import { formatDate, formatMoney, idOf, nameOf } from '@/lib/utils'
import type { ContactPerson, Product, Supplier } from '@/types'

type SortKey = 'companyName' | 'country' | 'city' | 'contacts' | 'createdAt'

type ProductLink = {
  _id: string
  productId?: Product | string | null
  supplierId?: Supplier | string | null
  supplierPrice?: number
  currency?: string
  MOQ?: string
  leadTime?: string
  notes?: string
  productInfoFile?: string
  packingImage?: string
  lastUpdated?: string
}

type FormState = {
  companyName: string
  country: string
  address: string
  postCode: string
  city: string
  province: string
  web: string
  contacts: ContactPerson[]
}

const EMPTY_FORM: FormState = {
  companyName: '',
  country: '',
  address: '',
  postCode: '',
  city: '',
  province: '',
  web: '',
  contacts: [emptyContact()],
}

function formFromSupplier(s: Supplier): FormState {
  return {
    companyName: s.companyName || '',
    country: s.country || '',
    address: s.address || '',
    postCode: s.postCode || '',
    city: s.city || '',
    province: s.province || '',
    web: s.web || '',
    contacts: s.contactPersons && s.contactPersons.length ? s.contactPersons.map((c) => ({ ...emptyContact(), ...c })) : [emptyContact()],
  }
}

export default function SuppliersPage() {
  const { canEdit, canDelete, canEmail } = useAuth()
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const { search, setSearch, highlightId } = useUrlSearch()
  const [countryFilter, setCountryFilter] = useState('')
  const sort = useSort<SortKey>('companyName')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [file, setFile] = useState<File | null>(null)
  const [removeFile, setRemoveFile] = useState(false)
  const [saving, setSaving] = useState(false)
  const [allProducts, setAllProducts] = useState<Product[]>([])
  const [productDrafts, setProductDrafts] = useState<DraftProductLink[]>([])

  const [detail, setDetail] = useState<Supplier | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setSuppliers(unwrapList<Supplier>(await api<unknown>('/api/suppliers')))
    } catch (err) {
      toast(errorMessage(err, 'Failed to load suppliers'), 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const countries = useMemo(
    () =>
      [...new Set(suppliers.map((s) => (s.country || '').trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [suppliers],
  )

  const filtered = useMemo(() => {
    const list = suppliers.filter((s) => {
      if (countryFilter && (s.country || '').trim() !== countryFilter) return false
      return includesText(
        [s.companyName, s.country, s.city, s.province, s.address, s.web, contactSearchBlob(s.contactPersons)],
        search,
      )
    })
    const accessor = (s: Supplier): unknown => {
      switch (sort.key) {
        case 'country':
          return s.country
        case 'city':
          return s.city
        case 'contacts':
          return contactsSummary(s.contactPersons)
        case 'createdAt':
          return s.createdAt ? new Date(s.createdAt).getTime() : 0
        default:
          return s.companyName
      }
    }
    const mult = sort.dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => mult * compareValues(accessor(a), accessor(b)))
  }, [suppliers, search, countryFilter, sort.key, sort.dir])

  const selection = useSelection(filtered)

  const [bulkDeleting, setBulkDeleting] = useState(false)

  async function deleteSelected() {
    if (!selection.count || bulkDeleting) return
    if (!window.confirm(`Delete ${selection.count} selected supplier(s)? This cannot be undone.`)) return
    setBulkDeleting(true)
    try {
      const res = await api<{ deleted?: number; message?: string }>('/api/suppliers/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids: selection.selectedIds }),
      })
      toast(res.message || `Deleted ${res.deleted ?? selection.count} supplier(s)`, 'success')
      selection.clear()
      await load()
    } catch (err) {
      toast(errorMessage(err, 'Bulk delete failed'), 'error')
    } finally {
      setBulkDeleting(false)
    }
  }

  function openCreate() {
    setEditing(null)
    setProductDrafts([])
    setForm(EMPTY_FORM)
    setFile(null)
    setRemoveFile(false)
    setFormOpen(true)
  }

  const openEdit = useCallback((s: Supplier) => {
    setEditing(s)
    setForm(formFromSupplier(s))
    setFile(null)
    setRemoveFile(false)
    setProductDrafts([])
    setFormOpen(true)
  }, [])

  useEffect(() => {
    if (searchParams.get('new') !== '1' || loading) return
    if (canEdit) openCreate()
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
  }, [searchParams, canEdit, loading, setSearchParams, openCreate])

  useEffect(() => {
    if (!formOpen || !canEdit) return
    let cancelled = false
    ;(async () => {
      try {
        const data = await api<unknown>('/api/products')
        if (!cancelled) setAllProducts(unwrapList<Product>(data))
      } catch {
        if (!cancelled) setAllProducts([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [formOpen, canEdit])

  function onCountrySelect(country: string, dial: string) {
    setForm((f) => ({
      ...f,
      country,
      contacts: f.contacts.map((c) => applyDialToContactPhones(c, dial)),
    }))
  }

  async function saveProductDrafts(supplierId: string) {
    for (const d of productDrafts) {
      try {
        const fd = new FormData()
        fd.append('productId', d.productId)
        fd.append('supplierId', supplierId)
        if (d.notes.trim()) fd.append('notes', d.notes.trim())
        const res = await apiForm<{ link?: { _id?: string } }>('/api/supplier-products', fd, 'POST')
        const hasPricing = d.supplierPrice !== '' || d.MOQ.trim() || d.leadTime.trim()
        if (res?.link?._id && hasPricing) {
          const put = new FormData()
          if (d.supplierPrice !== '') put.append('supplierPrice', d.supplierPrice)
          put.append('currency', d.currency.trim() || 'USD')
          put.append('MOQ', d.MOQ.trim())
          put.append('leadTime', d.leadTime.trim())
          if (d.notes.trim()) put.append('notes', d.notes.trim())
          await apiForm(`/api/supplier-products/${res.link._id}`, put, 'PUT')
        }
      } catch {
        /* skip duplicates */
      }
    }
  }

  function buildFormData(skipDuplicateCheck = false) {
    const fd = new FormData()
    fd.append('companyName', form.companyName.trim())
    fd.append('country', form.country.trim())
    fd.append('contactPersons', JSON.stringify(cleanContacts(form.contacts)))
    fd.append('address', form.address.trim())
    fd.append('postCode', form.postCode.trim())
    fd.append('city', form.city.trim())
    fd.append('province', form.province.trim())
    fd.append('web', form.web.trim())
    if (file) fd.append('productSpecsFile', file)
    if (editing && removeFile && !file) fd.append('removeProductSpecsFile', '1')
    if (!editing && skipDuplicateCheck) fd.append('skipDuplicateCheck', 'true')
    return fd
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canEdit) return
    if (!form.companyName.trim()) {
      toast('Company name is required', 'error')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        await apiForm(`/api/suppliers/${editing._id}`, buildFormData(), 'PUT')
        toast('Supplier updated', 'success')
      } else {
        let created: { supplier?: Supplier } | null = null
        try {
          created = await apiForm<{ supplier?: Supplier }>('/api/suppliers', buildFormData(), 'POST')
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            if (!window.confirm(`${err.message}. Create it anyway?`)) {
              setSaving(false)
              return
            }
            created = await apiForm<{ supplier?: Supplier }>('/api/suppliers', buildFormData(true), 'POST')
          } else {
            throw err
          }
        }
        if (created?.supplier?._id && productDrafts.length) {
          await saveProductDrafts(created.supplier._id)
        }
        toast('Supplier created', 'success')
      }
      setProductDrafts([])
      setFormOpen(false)
      await load()
    } catch (err) {
      toast(errorMessage(err, 'Failed to save supplier'), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(s: Supplier) {
    if (!window.confirm(`Delete supplier “${s.companyName}”? This cannot be undone.`)) return
    try {
      await api(`/api/suppliers/${s._id}`, { method: 'DELETE' })
      toast('Supplier deleted', 'success')
      if (detail?._id === s._id) setDetail(null)
      await load()
    } catch (err) {
      toast(errorMessage(err, 'Delete failed'), 'error')
    }
  }

  async function dismissNew(s: Supplier) {
    try {
      await api(`/api/suppliers/${s._id}`, { method: 'PUT', body: JSON.stringify({ showAsNew: false }) })
      setSuppliers((prev) => prev.map((x) => (x._id === s._id ? { ...x, showAsNew: false } : x)))
    } catch (err) {
      toast(errorMessage(err, 'Could not dismiss'), 'error')
    }
  }

  useEffect(() => {
    document.title = 'Suppliers | TRI Dashboard'
  }, [])

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Data</p>
          <h1>Suppliers</h1>
          <p className="page-lede">Factories and exporters you buy from — contacts and linked products.</p>
        </div>
      </header>

      <div className="suppliers-toolbar list-toolbar">
        <div className="toolbar-row">
          <div className="toolbar-group toolbar-search">
            <label htmlFor="supplierSearchInput">Search</label>
            <input
              type="search"
              id="supplierSearchInput"
              placeholder="Company, city, country…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="toolbar-group toolbar-compact">
            <label htmlFor="sortSuppliers">Sort by</label>
            <select
              id="sortSuppliers"
              value={
                sort.key === 'companyName' && sort.dir === 'desc'
                  ? 'company-desc'
                  : sort.key === 'city'
                    ? 'city'
                    : sort.key === 'country'
                      ? 'country'
                      : 'company-asc'
              }
              onChange={(e) => {
                const v = e.target.value
                if (v === 'company-asc') {
                  sort.setKey('companyName')
                  sort.setDir('asc')
                } else if (v === 'company-desc') {
                  sort.setKey('companyName')
                  sort.setDir('desc')
                } else if (v === 'city') {
                  sort.setKey('city')
                  sort.setDir('asc')
                } else if (v === 'country') {
                  sort.setKey('country')
                  sort.setDir('asc')
                }
              }}
            >
              <option value="company-asc">Company A–Z</option>
              <option value="company-desc">Company Z–A</option>
              <option value="city">City</option>
              <option value="country">Country</option>
            </select>
          </div>
          {canEdit ? (
            <div className="toolbar-actions">
              <EntityImportPanel type="suppliers" onDone={() => void load()} />
              <button
                type="button"
                className="btn toolbar-cta"
                id="toggleFormBtn"
                onClick={() => {
                  if (formOpen && !editing) setFormOpen(false)
                  else openCreate()
                }}
              >
                {formOpen && !editing ? 'Close form' : 'Add supplier'}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="bulk-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={selection.count !== 1}
          onClick={() => {
            const s = filtered.find((x) => x._id === selection.selectedIds[0])
            if (s) openEdit(s)
          }}
        >
          Edit
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={!canDelete || selection.count === 0 || bulkDeleting}
          onClick={() => void deleteSelected()}
        >
          {bulkDeleting ? 'Deleting…' : 'Delete'}
        </button>
        <Link
          className={`btn btn-secondary btn-sm${canEmail && selection.count ? '' : ' is-disabled'}`}
          to={
            selection.count
              ? `/mail?recipientType=supplier&recipientIds=${selection.selectedIds.join(',')}`
              : '/mail?recipientType=supplier'
          }
          aria-disabled={!canEmail || selection.count === 0}
          onClick={(e) => {
            if (!canEmail || selection.count === 0) e.preventDefault()
          }}
        >
          Email
        </Link>
        <div className={`selected-count${selection.count ? ' has-selection' : ''}`}>
          Selected: {selection.count}
        </div>
      </div>

      <form
        id="supplierForm"
        className={`form-container entity-form${formOpen ? ' show' : ''}`}
        style={{ display: formOpen ? 'block' : 'none' }}
        onSubmit={onSubmit}
        noValidate
      >
        <div className="form-grid">
          <div className="field">
            <label htmlFor="supplierCompanyName">Company Name</label>
            <input
              type="text"
              name="companyName"
              id="supplierCompanyName"
              required
              autoComplete="organization"
              value={form.companyName}
              onChange={(e) => setForm({ ...form, companyName: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="supplierCountry">Country</label>
            <CountryPicker
              id="supplierCountry"
              name="country"
              value={form.country}
              onChange={(country) => setForm({ ...form, country })}
              onSelect={onCountrySelect}
            />
          </div>
        </div>
        <p className="form-hint">Select a country first — dial codes are applied to contact phone numbers.</p>

        <div className="form-section">
          <div className="form-section-title">Contact person(s)</div>
          <p className="form-hint">Add name and email for each contact. Extra contacts are optional.</p>
          <div id="supplierContactsWidget">
            <ContactsEditor value={form.contacts} onChange={(contacts) => setForm({ ...form, contacts })} />
          </div>
        </div>

        <div className="form-section">
          <div className="form-section-title">Address &amp; details</div>
          <div className="form-grid">
            <div className="field span-2">
              <label htmlFor="supplierAddress">Address</label>
              <textarea
                id="supplierAddress"
                name="address"
                rows={2}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="supplierPostCode">Post Code</label>
              <input
                id="supplierPostCode"
                type="text"
                name="postCode"
                value={form.postCode}
                onChange={(e) => setForm({ ...form, postCode: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="supplierCity">City</label>
              <input
                id="supplierCity"
                type="text"
                name="city"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="supplierProvince">Province</label>
              <input
                id="supplierProvince"
                type="text"
                name="province"
                value={form.province}
                onChange={(e) => setForm({ ...form, province: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="supplierWeb">Web</label>
              <input
                id="supplierWeb"
                type="text"
                name="web"
                value={form.web}
                onChange={(e) => setForm({ ...form, web: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="supplierSpecScan">Visiting card</label>
              <input
                id="supplierSpecScan"
                type="file"
                name="specScan"
                accept="image/*,.pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>
          </div>
          {editing?.productSpecsFile ? (
            <div className="existing-files-hint">
              <label className="checkbox-row">
                <input type="checkbox" checked={removeFile} onChange={(e) => setRemoveFile(e.target.checked)} />
                Remove current file:{' '}
                <a href={uploadUrl(editing.productSpecsFile)} target="_blank" rel="noreferrer">
                  {displayFileName(editing.productSpecsFile)}
                </a>
              </label>
            </div>
          ) : null}
        </div>

        {!editing ? (
          <ProductAttachmentDrafts
            products={allProducts}
            drafts={productDrafts}
            onChange={setProductDrafts}
            showPricing
            disabled={saving || !canEdit}
            title="Linked products (optional)"
          />
        ) : null}

        <div className="form-actions">
          <button type="submit" className="btn btn-sm" id="supplierSubmitBtn" disabled={saving || !canEdit}>
            {saving ? 'Saving…' : 'Save supplier'}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            id="supplierCancelEditBtn"
            disabled={saving}
            onClick={() => {
              setFormOpen(false)
              setEditing(null)
              setProductDrafts([])
            }}
          >
            Cancel
          </button>
        </div>
      </form>

      {loading ? (
        <div className="loading-block">Loading suppliers…</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="checkbox-col">
                  <input
                    type="checkbox"
                    title="Select all"
                    checked={selection.allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = selection.someSelected
                    }}
                    onChange={() => selection.toggleAll()}
                  />
                </th>
                <th>Company</th>
                <th>Contacts</th>
                <th>City</th>
                <th>Country</th>
                <th>Email</th>
                <th>File</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr className="mobile-empty-row">
                  <td colSpan={8}>
                    {suppliers.length === 0 ? 'No suppliers yet.' : 'No suppliers match your filters.'}
                  </td>
                </tr>
              ) : (
                filtered.map((s) => {
                  const email =
                    (s.contactPersons || []).map((c) => c.email).find(Boolean) || '—'
                  return (
                    <tr
                      key={s._id}
                      className={
                        highlightId === s._id || selection.has(s._id) ? 'is-selected is-highlight' : undefined
                      }
                    >
                      <td className="checkbox-col">
                        <input
                          type="checkbox"
                          checked={selection.has(s._id)}
                          onChange={() => selection.toggle(s._id)}
                        />
                      </td>
                      <td className="mobile-card-primary">
                        <div className="avatar-chip">
                          <span className={`avatar-circle tone-${(s.companyName || '').length % 6}`}>
                            {(s.companyName || '?')
                              .split(/\s+/)
                              .slice(0, 2)
                              .map((w) => w[0] || '')
                              .join('')
                              .toUpperCase() || '?'}
                          </span>
                          <div>
                            <button
                              type="button"
                              className="entity-title"
                              style={{
                                border: 'none',
                                background: 'transparent',
                                color: 'var(--accent)',
                                padding: 0,
                                cursor: 'pointer',
                                textAlign: 'left',
                              }}
                              onClick={() => setDetail(s)}
                            >
                              {s.companyName || '—'}
                            </button>
                            <div className="entity-sub">
                              {[s.city, s.country].filter(Boolean).join(', ') || 'No location'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td data-label="Contacts">{contactsSummary(s.contactPersons) || '—'}</td>
                      <td data-label="City">{s.city || '—'}</td>
                      <td data-label="Country">{s.country || '—'}</td>
                      <td data-label="Email">{email}</td>
                      <td data-label="Specs">
                        {s.productSpecsFile ? (
                          <a href={uploadUrl(s.productSpecsFile)} target="_blank" rel="noreferrer">
                            {displayFileName(s.productSpecsFile)}
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="table-actions-cell" data-label="Actions">
                        <RowActionsMenu
                          items={[
                            { label: 'View', onClick: () => setDetail(s) },
                            { label: 'Edit', onClick: () => openEdit(s), hidden: !canEdit },
                            {
                              label: 'Email',
                              href: `/mail?recipientType=supplier&recipientId=${s._id}&template=offer-request`,
                              hidden: !canEmail,
                            },
                            {
                              label: 'Delete',
                              onClick: () => void onDelete(s),
                              danger: true,
                              hidden: !canDelete,
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

      {detail ? (
        <SupplierDetail
          supplier={detail}
          onClose={() => setDetail(null)}
          onEdit={() => {
            const s = detail
            setDetail(null)
            openEdit(s)
          }}
        />
      ) : null}
    </>
  )
}

type LinkForm = {
  supplierPrice: string
  currency: string
  MOQ: string
  leadTime: string
  notes: string
}

const EMPTY_LINK: LinkForm = { supplierPrice: '', currency: 'USD', MOQ: '', leadTime: '', notes: '' }

function SupplierDetail({
  supplier: initial,
  onClose,
  onEdit,
}: {
  supplier: Supplier
  onClose: () => void
  onEdit: () => void
}) {
  const { canEdit, canDelete, canEmail } = useAuth()
  const { toast } = useToast()
  const [supplier, setSupplier] = useState(initial)

  const [links, setLinks] = useState<ProductLink[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  const [addProduct, setAddProduct] = useState('')
  const [addForm, setAddForm] = useState<LinkForm>(EMPTY_LINK)
  const [addInfoFile, setAddInfoFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)

  const [editLink, setEditLink] = useState<ProductLink | null>(null)
  const [editForm, setEditForm] = useState<LinkForm>(EMPTY_LINK)
  const [editInfoFile, setEditInfoFile] = useState<File | null>(null)

  useEffect(() => {
    setSupplier(initial)
  }, [initial])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const fresh = await api<Supplier>(`/api/suppliers/${initial._id}`)
        if (!cancelled && fresh?._id) setSupplier(fresh)
      } catch {
        /* keep list snapshot */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [initial._id])

  const loadLinks = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<ProductLink[]>(`/api/suppliers/${supplier._id}/products`)
      setLinks(Array.isArray(data) ? data : [])
    } catch (err) {
      toast(errorMessage(err, 'Failed to load linked products'), 'error')
    } finally {
      setLoading(false)
    }
  }, [supplier._id, toast])

  useEffect(() => {
    void loadLinks()
  }, [loadLinks])

  useEffect(() => {
    if (!canEdit) return
    api<unknown>('/api/products')
      .then((p) => setProducts(unwrapList<Product>(p)))
      .catch((err) => toast(errorMessage(err, 'Failed to load products'), 'error'))
  }, [canEdit, toast])

  const linkedIds = new Set(links.map((l) => idOf(l.productId)))

  function linkFormData(f: LinkForm, infoFile: File | null) {
    const fd = new FormData()
    fd.append('notes', f.notes.trim())
    if (f.supplierPrice !== '') fd.append('supplierPrice', f.supplierPrice)
    fd.append('currency', f.currency.trim() || 'USD')
    fd.append('MOQ', f.MOQ.trim())
    fd.append('leadTime', f.leadTime.trim())
    if (infoFile) fd.append('productInfoFile', infoFile)
    return fd
  }

  async function createLink() {
    if (!addProduct) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('productId', addProduct)
      fd.append('supplierId', supplier._id)
      if (addForm.notes.trim()) fd.append('notes', addForm.notes.trim())
      if (addInfoFile) fd.append('productInfoFile', addInfoFile)
      const res = await apiForm<{ link?: ProductLink }>('/api/supplier-products', fd, 'POST')
      // POST only stores notes/files; follow with PUT for pricing fields
      const hasPricing = addForm.supplierPrice !== '' || addForm.MOQ.trim() || addForm.leadTime.trim()
      if (res?.link?._id && hasPricing) {
        await apiForm(`/api/supplier-products/${res.link._id}`, linkFormData(addForm, null), 'PUT')
      }
      setAddProduct('')
      setAddForm(EMPTY_LINK)
      setAddInfoFile(null)
      toast('Product linked', 'success')
      await loadLinks()
    } catch (err) {
      toast(errorMessage(err, 'Could not link product'), 'error')
    } finally {
      setBusy(false)
    }
  }

  function openEditLink(l: ProductLink) {
    setEditLink(l)
    setEditInfoFile(null)
    setEditForm({
      supplierPrice: l.supplierPrice != null ? String(l.supplierPrice) : '',
      currency: l.currency || 'USD',
      MOQ: l.MOQ || '',
      leadTime: l.leadTime || '',
      notes: l.notes || '',
    })
  }

  async function saveEditLink() {
    if (!editLink) return
    setBusy(true)
    try {
      await apiForm(`/api/supplier-products/${editLink._id}`, linkFormData(editForm, editInfoFile), 'PUT')
      toast('Link updated', 'success')
      setEditLink(null)
      await loadLinks()
    } catch (err) {
      toast(errorMessage(err, 'Could not update link'), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function removeLink(l: ProductLink) {
    if (!window.confirm(`Unlink ${nameOf(l.productId)} from this supplier?`)) return
    try {
      await api(`/api/supplier-products/${l._id}`, { method: 'DELETE' })
      toast('Link removed', 'success')
      await loadLinks()
    } catch (err) {
      toast(errorMessage(err, 'Could not remove link'), 'error')
    }
  }

  const contacts = supplier.contactPersons || []

  return (
    <Modal
      large
      title={supplier.companyName || 'Supplier'}
      onClose={onClose}
      footer={
        <>
          {canEmail && (
            <Link
              className="action-btn"
              to={`/mail?recipientType=supplier&recipientId=${supplier._id}&template=offer-request`}
            >
              Email supplier
            </Link>
          )}
          {canEdit && (
            <button type="button" className="btn" onClick={onEdit}>
              Edit supplier
            </button>
          )}
        </>
      }
    >
      <div className="form-grid" style={{ marginBottom: 18 }}>
        <Info label="Country">{supplier.country || '—'}</Info>
        <Info label="City / province">{[supplier.city, supplier.province].filter(Boolean).join(', ') || '—'}</Info>
        <Info label="Post code">{supplier.postCode || '—'}</Info>
        <Info label="Website">{supplier.web || '—'}</Info>
        <div className="span-2">
          <Info label="Address">{supplier.address || '—'}</Info>
        </div>
        <div className="span-2">
          <Info label="Specs / card file">
            {supplier.productSpecsFile ? (
              <a href={uploadUrl(supplier.productSpecsFile)} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                {displayFileName(supplier.productSpecsFile)}
              </a>
            ) : (
              '—'
            )}
          </Info>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Contacts ({contacts.length})</div>
        {contacts.length === 0 ? (
          <div className="empty-state" style={{ padding: 16 }}>No contacts recorded.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Department</th>
                  <th>Tel / mobile</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c, i) => (
                  <tr key={i}>
                    <td>{c.name || '—'}</td>
                    <td>{c.email || '—'}</td>
                    <td>{c.department || '—'}</td>
                    <td>{[c.tel, c.mobile].filter(Boolean).join(' / ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 0 }}>
        <div className="panel-title">Linked products ({links.length})</div>
        {loading ? (
          <div className="loading-block">Loading…</div>
        ) : links.length === 0 ? (
          <div className="empty-state" style={{ padding: 16 }}>No products linked yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>HS code</th>
                  <th>Price</th>
                  <th>MOQ</th>
                  <th>Lead time</th>
                  <th>Notes</th>
                  <th>Info file</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {links.map((l) => {
                  const prod = typeof l.productId === 'object' ? l.productId : null
                  return (
                    <tr key={l._id}>
                      <td>{nameOf(l.productId)}</td>
                      <td>{prod?.hsCode || '—'}</td>
                      <td>{formatMoney(l.supplierPrice, l.currency || 'USD')}</td>
                      <td>{l.MOQ || '—'}</td>
                      <td>{l.leadTime || '—'}</td>
                      <td>{l.notes || '—'}</td>
                      <td>
                        {l.productInfoFile ? (
                          <a href={uploadUrl(l.productInfoFile)} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                            Open
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{formatDate(l.lastUpdated)}</td>
                      <td>
                        <div className="row-actions">
                          {canEdit && (
                            <button type="button" className="action-btn" onClick={() => openEditLink(l)}>
                              Edit
                            </button>
                          )}
                          {canDelete && (
                            <button type="button" className="action-btn delete-btn" onClick={() => void removeLink(l)}>
                              Unlink
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {canEdit && (
          <div style={{ marginTop: 14 }}>
            <div className="card-title" style={{ marginBottom: 8 }}>Link a product</div>
            <div className="form-grid">
              <div className="field span-2">
                <label>Product</label>
                <select value={addProduct} onChange={(e) => setAddProduct(e.target.value)}>
                  <option value="">Select product…</option>
                  {products
                    .filter((p) => !linkedIds.has(p._id))
                    .map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>
              <LinkFields form={addForm} onChange={setAddForm} />
              <div className="field span-2">
                <label>Product info file (optional)</label>
                <input type="file" onChange={(e) => setAddInfoFile(e.target.files?.[0] || null)} />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <button type="button" className="btn" disabled={!addProduct || busy} onClick={() => void createLink()}>
                {busy ? 'Linking…' : 'Link product'}
              </button>
            </div>
          </div>
        )}
      </div>

      {editLink && (
        <Modal
          title={`Edit link — ${nameOf(editLink.productId)}`}
          onClose={() => !busy && setEditLink(null)}
          footer={
            <>
              <button type="button" className="action-btn" disabled={busy} onClick={() => setEditLink(null)}>
                Cancel
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => void saveEditLink()}>
                {busy ? 'Saving…' : 'Save link'}
              </button>
            </>
          }
        >
          <div className="form-grid">
            <LinkFields form={editForm} onChange={setEditForm} />
            <div className="field span-2">
              <label>Replace product info file</label>
              <input type="file" onChange={(e) => setEditInfoFile(e.target.files?.[0] || null)} />
              {editLink.productInfoFile && (
                <a href={uploadUrl(editLink.productInfoFile)} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: 12 }}>
                  Current: {displayFileName(editLink.productInfoFile)}
                </a>
              )}
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  )
}

function LinkFields({ form, onChange }: { form: LinkForm; onChange: (f: LinkForm) => void }) {
  return (
    <>
      <div className="field">
        <label>Supplier price</label>
        <input
          type="number"
          step="any"
          min="0"
          value={form.supplierPrice}
          onChange={(e) => onChange({ ...form, supplierPrice: e.target.value })}
        />
      </div>
      <div className="field">
        <label>Currency</label>
        <input value={form.currency} onChange={(e) => onChange({ ...form, currency: e.target.value.toUpperCase() })} />
      </div>
      <div className="field">
        <label>MOQ</label>
        <input value={form.MOQ} onChange={(e) => onChange({ ...form, MOQ: e.target.value })} />
      </div>
      <div className="field">
        <label>Lead time</label>
        <input value={form.leadTime} onChange={(e) => onChange({ ...form, leadTime: e.target.value })} />
      </div>
      <div className="field span-2">
        <label>Notes</label>
        <textarea value={form.notes} onChange={(e) => onChange({ ...form, notes: e.target.value })} />
      </div>
    </>
  )
}
