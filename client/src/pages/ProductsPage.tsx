import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useUrlSearch } from '@/hooks/useUrlSearch'
import { api, apiForm, ApiError } from '@/api/client'
import { RowActionsMenu } from '@/components/RowActionsMenu'
import { Info } from '@/components/ui/Info'
import { Modal } from '@/components/ui/Modal'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useSort } from '@/hooks/useSort'
import { useSelection } from '@/hooks/useSelection'
import {
  compareValues,
  displayFileName,
  errorMessage,
  includesText,
  unwrapList,
  uploadUrl,
} from '@/lib/entity'
import { formatDate, formatMoney, idOf, nameOf } from '@/lib/utils'
import type { Client, ContactPerson, Product, Supplier } from '@/types'

type SortKey = 'name' | 'category' | 'hsCode' | 'importDuty' | 'updatedAt'

type SupplierLink = {
  _id: string
  supplierId?: Supplier | string | null
  productId?: Product | string | null
  supplierPrice?: number
  currency?: string
  MOQ?: string
  leadTime?: string
  notes?: string
}

type ClientLink = {
  _id: string
  clientId?: (Client & { email?: string }) | string | null
  productId?: Product | string | null
  notes?: string
}

type FormState = {
  name: string
  hsCode: string
  packing: string
  productNote: string
  importDuty: string
  incomeTax: string
  salesTax: string
  categories: string[]
}

const EMPTY_FORM: FormState = {
  name: '',
  hsCode: '',
  packing: '',
  productNote: '',
  importDuty: '0',
  incomeTax: '0',
  salesTax: '0',
  categories: [],
}

function categoriesOf(p: Product) {
  if (p.categories && p.categories.length) return p.categories
  return p.category ? [p.category] : []
}

function formFromProduct(p: Product): FormState {
  return {
    name: p.name || '',
    hsCode: p.hsCode || '',
    packing: p.packing || '',
    productNote: p.productNote || '',
    importDuty: String(p.importDuty ?? 0),
    incomeTax: String(p.incomeTax ?? 0),
    salesTax: String(p.salesTax ?? 0),
    categories: categoriesOf(p),
  }
}

function firstContactEmail(list?: ContactPerson[]) {
  return (list || []).map((c) => c.email).find(Boolean) || ''
}

export default function ProductsPage() {
  const { canEdit, canDelete } = useAuth()
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [hsCodes, setHsCodes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const { search, setSearch, highlightId } = useUrlSearch()
  const [categoryFilter, setCategoryFilter] = useState('')
  const [newOnly, setNewOnly] = useState(false)
  const sort = useSort<SortKey>('name')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [newCategory, setNewCategory] = useState('')
  const [extraCategories, setExtraCategories] = useState<string[]>([])
  const [newFiles, setNewFiles] = useState<File[]>([])
  const [removeDocs, setRemoveDocs] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const [detail, setDetail] = useState<Product | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [prods, cats, hs] = await Promise.all([
        api<unknown>('/api/products'),
        api<string[]>('/api/product-categories').catch(() => [] as string[]),
        api<string[]>('/api/products/hs-codes/list').catch(() => [] as string[]),
      ])
      setProducts(unwrapList<Product>(prods))
      setCategories(Array.isArray(cats) ? cats : [])
      setHsCodes(Array.isArray(hs) ? hs : [])
    } catch (err) {
      toast(errorMessage(err, 'Failed to load products'), 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const allCategories = useMemo(() => {
    const set = new Map<string, string>()
    for (const c of [...categories, ...extraCategories, ...form.categories]) {
      const key = c.trim().toLowerCase()
      if (key && !set.has(key)) set.set(key, c.trim())
    }
    return [...set.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [categories, extraCategories, form.categories])

  const filtered = useMemo(() => {
    const list = products.filter((p) => {
      if (newOnly && !p.showAsNew) return false
      if (categoryFilter && !categoriesOf(p).some((c) => c.toLowerCase() === categoryFilter.toLowerCase())) {
        return false
      }
      return includesText(
        [p.name, categoriesOf(p).join(' '), p.hsCode, p.packing, p.productNote, p.specs],
        search,
      )
    })
    const accessor = (p: Product): unknown => {
      switch (sort.key) {
        case 'category':
          return categoriesOf(p).join(', ')
        case 'hsCode':
          return p.hsCode
        case 'importDuty':
          return p.importDuty ?? 0
        case 'updatedAt':
          return p.updatedAt ? new Date(p.updatedAt).getTime() : 0
        default:
          return p.name
      }
    }
    const mult = sort.dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => mult * compareValues(accessor(a), accessor(b)))
  }, [products, search, categoryFilter, newOnly, sort.key, sort.dir])

  const selection = useSelection(filtered)

  const newCount = useMemo(() => products.filter((p) => p.showAsNew).length, [products])

  async function deleteSelected() {
    if (!selection.count) return
    if (!window.confirm(`Delete ${selection.count} selected product(s)? This cannot be undone.`)) return
    try {
      for (const id of selection.selectedIds) {
        await api(`/api/products/${id}`, { method: 'DELETE' })
      }
      toast(`Deleted ${selection.count} product(s)`, 'success')
      selection.clear()
      await load()
    } catch (err) {
      toast(errorMessage(err, 'Bulk delete failed'), 'error')
    }
  }

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setNewCategory('')
    setNewFiles([])
    setRemoveDocs([])
    setFormOpen(true)
  }

  const openEdit = useCallback((p: Product) => {
    setEditing(p)
    setForm(formFromProduct(p))
    setNewCategory('')
    setNewFiles([])
    setRemoveDocs([])
    setFormOpen(true)
  }, [])

  // ?new=1 opens the create form (mirrors the old "new entry" shortcut)
  useEffect(() => {
    if (searchParams.get('new') !== '1' || loading) return
    if (canEdit) openCreate()
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
  }, [searchParams, canEdit, loading, setSearchParams, openCreate])

  function toggleCategory(name: string) {
    setForm((f) => {
      const has = f.categories.some((c) => c.toLowerCase() === name.toLowerCase())
      return {
        ...f,
        categories: has
          ? f.categories.filter((c) => c.toLowerCase() !== name.toLowerCase())
          : [...f.categories, name],
      }
    })
  }

  function addNewCategory() {
    const name = newCategory.trim()
    if (!name) return
    setExtraCategories((prev) => (prev.some((c) => c.toLowerCase() === name.toLowerCase()) ? prev : [...prev, name]))
    setForm((f) =>
      f.categories.some((c) => c.toLowerCase() === name.toLowerCase())
        ? f
        : { ...f, categories: [...f.categories, name] },
    )
    setNewCategory('')
  }

  function buildFormData(skipDuplicateCheck = false) {
    const fd = new FormData()
    fd.append('name', form.name.trim())
    fd.append('categories', JSON.stringify(form.categories))
    fd.append('hsCode', form.hsCode.trim())
    fd.append('packing', form.packing.trim())
    fd.append('productNote', form.productNote.trim())
    fd.append('importDuty', form.importDuty || '0')
    fd.append('incomeTax', form.incomeTax || '0')
    fd.append('salesTax', form.salesTax || '0')
    for (const file of newFiles) fd.append('otherDocuments', file)
    if (editing) {
      if (removeDocs.length) fd.append('removeOtherDocuments', JSON.stringify(removeDocs))
    } else if (skipDuplicateCheck) {
      fd.append('skipDuplicateCheck', 'true')
    }
    return fd
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canEdit) return
    if (!form.name.trim()) {
      toast('Product name is required', 'error')
      return
    }
    if (!form.categories.length) {
      toast('Select at least one category', 'error')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        await apiForm(`/api/products/${editing._id}`, buildFormData(), 'PUT')
        toast('Product updated', 'success')
      } else {
        try {
          await apiForm('/api/products', buildFormData(), 'POST')
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            if (!window.confirm(`${err.message}. Create it anyway?`)) {
              setSaving(false)
              return
            }
            await apiForm('/api/products', buildFormData(true), 'POST')
          } else {
            throw err
          }
        }
        toast('Product created', 'success')
      }
      setFormOpen(false)
      await load()
    } catch (err) {
      toast(errorMessage(err, 'Failed to save product'), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function onDuplicate(p: Product) {
    try {
      await api(`/api/products/${p._id}/duplicate`, { method: 'POST' })
      toast(`Duplicated “${p.name}”`, 'success')
      await load()
    } catch (err) {
      toast(errorMessage(err, 'Duplicate failed'), 'error')
    }
  }

  async function onDelete(p: Product) {
    if (!window.confirm(`Delete product “${p.name}”? This cannot be undone.`)) return
    try {
      await api(`/api/products/${p._id}`, { method: 'DELETE' })
      toast('Product deleted', 'success')
      if (detail?._id === p._id) setDetail(null)
      await load()
    } catch (err) {
      toast(errorMessage(err, 'Delete failed'), 'error')
    }
  }

  async function dismissNew(p: Product) {
    try {
      await api(`/api/products/${p._id}`, {
        method: 'PUT',
        body: JSON.stringify({ showAsNew: false }),
      })
      setProducts((prev) => prev.map((x) => (x._id === p._id ? { ...x, showAsNew: false } : x)))
    } catch (err) {
      toast(errorMessage(err, 'Could not dismiss'), 'error')
    }
  }

  const existingDocs = editing?.otherDocuments || []

  useEffect(() => {
    document.title = 'Product Management'
  }, [])

  const sortSelectValue =
    sort.key === 'name' && sort.dir === 'desc'
      ? 'name-desc'
      : sort.key === 'category'
        ? 'category'
        : sort.key === 'hsCode'
          ? 'hsCode'
          : 'name-asc'

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Products</h1>
          <p className="page-lede">Catalog items with specs, packing, and supplier / client links.</p>
        </div>
      </header>

      <div className="products-toolbar list-toolbar">
        <div className="toolbar-row">
          <div className="toolbar-group toolbar-search">
            <label htmlFor="searchInput">Search</label>
            <input
              type="search"
              id="searchInput"
              placeholder="Name, category, HS code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="toolbar-group toolbar-compact">
            <label htmlFor="filterCategory">Category</label>
            <select
              id="filterCategory"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="toolbar-group toolbar-compact">
            <label htmlFor="sortProducts">Sort by</label>
            <select
              id="sortProducts"
              value={sortSelectValue}
              onChange={(e) => {
                const v = e.target.value
                if (v === 'name-asc') {
                  sort.setKey('name')
                  sort.setDir('asc')
                } else if (v === 'name-desc') {
                  sort.setKey('name')
                  sort.setDir('desc')
                } else if (v === 'category') {
                  sort.setKey('category')
                  sort.setDir('asc')
                } else if (v === 'hsCode') {
                  sort.setKey('hsCode')
                  sort.setDir('asc')
                }
              }}
            >
              <option value="name-asc">Name A–Z</option>
              <option value="name-desc">Name Z–A</option>
              <option value="category">Category</option>
              <option value="hsCode">HS Code</option>
            </select>
          </div>
          {canEdit ? (
            <div className="toolbar-actions">
              <button
                type="button"
                className="btn toolbar-cta"
                id="toggleFormBtn"
                onClick={() => {
                  if (formOpen && !editing) setFormOpen(false)
                  else openCreate()
                }}
              >
                {formOpen && !editing ? 'Close form' : 'Add product'}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="bulk-actions" id="bulkActionsToolbar">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={selection.count !== 1}
          onClick={() => {
            const p = filtered.find((x) => x._id === selection.selectedIds[0])
            if (p) openEdit(p)
          }}
        >
          Edit
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={!canDelete || selection.count === 0}
          onClick={() => void deleteSelected()}
        >
          Delete
        </button>
        <div className={`selected-count${selection.count ? ' has-selection' : ''}`}>
          Selected: {selection.count}
        </div>
      </div>

      <div className={`form-container entity-form${formOpen ? ' show' : ''}`} id="productFormContainer">
        <form id="productForm" onSubmit={onSubmit}>
          <div className="form-section" style={{ borderTop: 'none', paddingTop: 0, marginTop: 0 }}>
          <div className="form-section-title">
            Categories <span className="form-hint">(select any number)</span>
          </div>
          <div className="category-checkboxes" id="productCategoriesCheckboxes">
            {allCategories.length === 0 ? (
              <span className="form-hint">No categories yet — add one below.</span>
            ) : (
              allCategories.map((c) => (
                <label key={c}>
                  <input
                    type="checkbox"
                    checked={form.categories.some((x) => x.toLowerCase() === c.toLowerCase())}
                    onChange={() => toggleCategory(c)}
                  />
                  {c}
                </label>
              ))
            )}
          </div>
          <div className="category-new-row">
            <input
              type="text"
              id="productNewCategoryInput"
              placeholder="New category name"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addNewCategory()
                }
              }}
            />
            <button type="button" className="action-btn" id="productAddCategoryBtn" onClick={addNewCategory}>
              Add to list
            </button>
          </div>
          </div>

          <div className="form-section">
          <div className="form-section-title">Details</div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="productFormHsCode">HS Code</label>
              <input
                type="text"
                name="hsCode"
                id="productFormHsCode"
                list="hsCodeList"
                placeholder="Type or select from list"
                required
                value={form.hsCode}
                onChange={(e) => setForm({ ...form, hsCode: e.target.value })}
              />
              <datalist id="hsCodeList">
                {hsCodes.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label htmlFor="productNameInput">Product Name</label>
              <input
                type="text"
                name="name"
                id="productNameInput"
                required
                autoComplete="off"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="productPacking">Packing</label>
              <input
                id="productPacking"
                type="text"
                name="packing"
                required
                value={form.packing}
                onChange={(e) => setForm({ ...form, packing: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="productFormOtherDocs">Other documents</label>
              <input
                type="file"
                name="otherDocuments"
                id="productFormOtherDocs"
                multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                onChange={(e) => setNewFiles(Array.from(e.target.files || []))}
              />
            </div>
            <div className="field span-2">
              <label htmlFor="productFormProductNote">Product note</label>
              <textarea
                name="productNote"
                id="productFormProductNote"
                rows={2}
                placeholder="Optional internal note"
                value={form.productNote}
                onChange={(e) => setForm({ ...form, productNote: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="productImportDuty">Import Duty (%)</label>
              <input
                id="productImportDuty"
                type="number"
                name="importDuty"
                required
                step="0.01"
                value={form.importDuty}
                onChange={(e) => setForm({ ...form, importDuty: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="productIncomeTax">Income Tax (%)</label>
              <input
                id="productIncomeTax"
                type="number"
                name="incomeTax"
                required
                step="0.01"
                value={form.incomeTax}
                onChange={(e) => setForm({ ...form, incomeTax: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="productSalesTax">Sales Tax (%)</label>
              <input
                id="productSalesTax"
                type="number"
                name="salesTax"
                required
                step="0.01"
                value={form.salesTax}
                onChange={(e) => setForm({ ...form, salesTax: e.target.value })}
              />
            </div>
          </div>
          {editing && existingDocs.length > 0 ? (
            <div className="existing-files-hint">
              {existingDocs.map((f) => (
                <label key={f} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                  <input
                    type="checkbox"
                    checked={removeDocs.includes(f)}
                    onChange={(e) =>
                      setRemoveDocs((prev) =>
                        e.target.checked ? [...prev, f] : prev.filter((x) => x !== f),
                      )
                    }
                  />
                  <a href={uploadUrl(f)} target="_blank" rel="noreferrer">
                    {displayFileName(f)}
                  </a>
                  <span className="form-hint">(tick to remove)</span>
                </label>
              ))}
            </div>
          ) : null}
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-sm" id="productSubmitBtn" disabled={saving || !canEdit}>
              {saving ? 'Saving…' : 'Save product'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              id="productCancelEditBtn"
              disabled={saving}
              onClick={() => {
                setFormOpen(false)
                setEditing(null)
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>

      {loading ? (
        <div className="loading-block">Loading products…</div>
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
                <th>Name</th>
                <th>Categories</th>
                <th>Packing</th>
                <th>HS Code</th>
                <th>Taxes</th>
                <th>Note</th>
                <th>Other docs</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr className="mobile-empty-row">
                  <td colSpan={9}>
                    {products.length === 0 ? 'No products yet.' : 'No products match your filters.'}
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr
                    key={p._id}
                    className={
                      highlightId === p._id || selection.has(p._id) ? 'is-selected is-highlight' : undefined
                    }
                  >
                    <td className="checkbox-col">
                      <input
                        type="checkbox"
                        checked={selection.has(p._id)}
                        onChange={() => selection.toggle(p._id)}
                      />
                    </td>
                    <td className="mobile-card-primary">
                      <div className="avatar-chip">
                        <span className={`avatar-circle tone-${(p.name || '').length % 6}`}>
                          {(p.name || '?').slice(0, 2).toUpperCase()}
                        </span>
                        <div>
                          {p.showAsNew ? <span className="badge badge-accent">New</span> : null}
                          <button
                            type="button"
                            className="entity-title"
                            style={{
                              border: 'none',
                              background: 'transparent',
                              color: 'var(--accent)',
                              padding: 0,
                              cursor: 'pointer',
                              display: 'block',
                              textAlign: 'left',
                            }}
                            onClick={() => setDetail(p)}
                          >
                            {p.name || '—'}
                          </button>
                          <div className="entity-sub">{p.hsCode || 'No HS code'}</div>
                          {p.showAsNew && canEdit ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{ marginTop: 4, height: 28 }}
                              onClick={() => void dismissNew(p)}
                            >
                              Dismiss
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td data-label="Categories">{categoriesOf(p).join(', ') || '—'}</td>
                    <td data-label="Packing">{p.packing || '—'}</td>
                    <td data-label="HS Code">{p.hsCode || '—'}</td>
                    <td data-label="Taxes">
                      {p.importDuty ?? 0} / {p.incomeTax ?? 0} / {p.salesTax ?? 0}
                    </td>
                    <td data-label="Note">{p.productNote || '—'}</td>
                    <td data-label="Other docs">
                      {p.otherDocuments && p.otherDocuments.length
                        ? p.otherDocuments.map((f) => (
                            <div key={f}>
                              <a href={uploadUrl(f)} target="_blank" rel="noreferrer">
                                {displayFileName(f)}
                              </a>
                            </div>
                          ))
                        : '—'}
                    </td>
                    <td className="table-actions-cell" data-label="Actions">
                      <RowActionsMenu
                        items={[
                          { label: 'View', onClick: () => setDetail(p) },
                          { label: 'Edit', onClick: () => openEdit(p), hidden: !canEdit },
                          { label: 'Duplicate', onClick: () => void onDuplicate(p), hidden: !canEdit },
                          { label: 'Delete', onClick: () => void onDelete(p), danger: true, hidden: !canDelete },
                        ]}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {detail ? (
        <ProductDetail
          product={detail}
          onClose={() => setDetail(null)}
          onEdit={() => {
            const p = detail
            setDetail(null)
            openEdit(p)
          }}
        />
      ) : null}
    </>
  )
}

function ProductDetail({
  product,
  onClose,
  onEdit,
}: {
  product: Product
  onClose: () => void
  onEdit: () => void
}) {
  const { canEdit, canDelete, canEmail } = useAuth()
  const { toast } = useToast()

  const [supplierLinks, setSupplierLinks] = useState<SupplierLink[]>([])
  const [clientLinks, setClientLinks] = useState<ClientLink[]>([])
  const [loading, setLoading] = useState(true)

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [supplierPick, setSupplierPick] = useState('')
  const [supplierNotes, setSupplierNotes] = useState('')
  const [clientPick, setClientPick] = useState('')
  const [clientNotes, setClientNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const loadLinks = useCallback(async () => {
    setLoading(true)
    try {
      const [s, c] = await Promise.all([
        api<SupplierLink[]>(`/api/products/${product._id}/linked-suppliers`),
        api<ClientLink[]>(`/api/products/${product._id}/linked-clients`),
      ])
      setSupplierLinks(Array.isArray(s) ? s : [])
      setClientLinks(Array.isArray(c) ? c : [])
    } catch (err) {
      toast(errorMessage(err, 'Failed to load linked records'), 'error')
    } finally {
      setLoading(false)
    }
  }, [product._id, toast])

  useEffect(() => {
    void loadLinks()
  }, [loadLinks])

  useEffect(() => {
    if (!canEdit) return
    Promise.all([api<unknown>('/api/suppliers'), api<unknown>('/api/clients')])
      .then(([s, c]) => {
        setSuppliers(unwrapList<Supplier>(s))
        setClients(unwrapList<Client>(c))
      })
      .catch((err) => toast(errorMessage(err, 'Failed to load suppliers/clients'), 'error'))
  }, [canEdit, toast])

  const linkedSupplierIds = new Set(supplierLinks.map((l) => idOf(l.supplierId)))
  const linkedClientIds = new Set(clientLinks.map((l) => idOf(l.clientId)))

  async function addSupplierLink() {
    if (!supplierPick) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('productId', product._id)
      fd.append('supplierId', supplierPick)
      if (supplierNotes.trim()) fd.append('notes', supplierNotes.trim())
      await apiForm('/api/supplier-products', fd, 'POST')
      setSupplierPick('')
      setSupplierNotes('')
      toast('Supplier linked', 'success')
      await loadLinks()
    } catch (err) {
      toast(errorMessage(err, 'Could not link supplier'), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function addClientLink() {
    if (!clientPick) return
    setBusy(true)
    try {
      await api('/api/product-clients', {
        method: 'POST',
        body: JSON.stringify({
          productId: product._id,
          clientId: clientPick,
          notes: clientNotes.trim() || undefined,
        }),
      })
      setClientPick('')
      setClientNotes('')
      toast('Client linked', 'success')
      await loadLinks()
    } catch (err) {
      toast(errorMessage(err, 'Could not link client'), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function removeSupplierLink(id: string) {
    if (!window.confirm('Remove this supplier link?')) return
    try {
      await api(`/api/supplier-products/${id}`, { method: 'DELETE' })
      toast('Link removed', 'success')
      await loadLinks()
    } catch (err) {
      toast(errorMessage(err, 'Could not remove link'), 'error')
    }
  }

  async function removeClientLink(id: string) {
    if (!window.confirm('Remove this client link?')) return
    try {
      await api(`/api/product-clients/${id}`, { method: 'DELETE' })
      toast('Link removed', 'success')
      await loadLinks()
    } catch (err) {
      toast(errorMessage(err, 'Could not remove link'), 'error')
    }
  }

  const cats = categoriesOf(product)

  return (
    <Modal
      large
      title={product.name || 'Product'}
      onClose={onClose}
      footer={
        <>
          {canEmail && (
            <Link
              className="action-btn"
              to={`/mail?productId=${product._id}&recipientType=supplier&template=offer-request`}
            >
              Email suppliers
            </Link>
          )}
          {canEmail && (
            <Link
              className="action-btn"
              to={`/mail?productId=${product._id}&recipientType=client&template=product-details-pricing`}
            >
              Email clients
            </Link>
          )}
          {canEdit && (
            <button type="button" className="btn" onClick={onEdit}>
              Edit product
            </button>
          )}
        </>
      }
    >
      <div className="form-grid" style={{ marginBottom: 18 }}>
        <Info label="Categories">
          {cats.length ? cats.map((c) => <span className="badge" style={{ marginRight: 4 }} key={c}>{c}</span>) : '—'}
        </Info>
        <Info label="HS code">{product.hsCode || '—'}</Info>
        <Info label="Packing">{product.packing || '—'}</Info>
        <Info label="Import duty">{product.importDuty ?? 0}%</Info>
        <Info label="Income tax">{product.incomeTax ?? 0}%</Info>
        <Info label="Sales tax">{product.salesTax ?? 0}%</Info>
        <div className="span-2">
          <Info label="Product note">{product.productNote || '—'}</Info>
        </div>
        <div className="span-2">
          <Info label="Other documents">
            {product.otherDocuments && product.otherDocuments.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {product.otherDocuments.map((f) => (
                  <a key={f} href={uploadUrl(f)} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                    {displayFileName(f)}
                  </a>
                ))}
              </div>
            ) : (
              '—'
            )}
          </Info>
        </div>
      </div>

      {loading ? (
        <div className="loading-block">Loading linked records…</div>
      ) : (
        <>
          <div className="panel">
            <div className="panel-title">Linked suppliers ({supplierLinks.length})</div>
            {supplierLinks.length === 0 ? (
              <div className="empty-state" style={{ padding: 16 }}>No suppliers linked yet.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Supplier</th>
                      <th>Contact email</th>
                      <th>Price</th>
                      <th>MOQ</th>
                      <th>Lead time</th>
                      <th>Notes</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {supplierLinks.map((l) => {
                      const sup = typeof l.supplierId === 'object' ? l.supplierId : null
                      return (
                        <tr key={l._id}>
                          <td>{nameOf(l.supplierId)}</td>
                          <td>{firstContactEmail(sup?.contactPersons) || '—'}</td>
                          <td>{formatMoney(l.supplierPrice, l.currency || 'USD')}</td>
                          <td>{l.MOQ || '—'}</td>
                          <td>{l.leadTime || '—'}</td>
                          <td>{l.notes || '—'}</td>
                          <td>
                            {canDelete && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => void removeSupplierLink(l._id)}
                              >
                                Unlink
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {canEdit && (
              <div className="products-toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
                <div className="field" style={{ minWidth: 220 }}>
                  <select value={supplierPick} onChange={(e) => setSupplierPick(e.target.value)} aria-label="Supplier to link">
                    <option value="">Link a supplier…</option>
                    {suppliers
                      .filter((s) => !linkedSupplierIds.has(s._id))
                      .map((s) => (
                        <option key={s._id} value={s._id}>
                          {s.companyName}
                        </option>
                      ))}
                  </select>
                </div>
                <input
                  type="text"
                  placeholder="Notes (optional)"
                  value={supplierNotes}
                  onChange={(e) => setSupplierNotes(e.target.value)}
                />
                <button type="button" className="btn" disabled={!supplierPick || busy} onClick={() => void addSupplierLink()}>
                  Link supplier
                </button>
              </div>
            )}
          </div>

          <div className="panel" style={{ marginBottom: 0 }}>
            <div className="panel-title">Linked clients ({clientLinks.length})</div>
            {clientLinks.length === 0 ? (
              <div className="empty-state" style={{ padding: 16 }}>No clients linked yet.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Contact email</th>
                      <th>Notes</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {clientLinks.map((l) => {
                      const cl = typeof l.clientId === 'object' ? l.clientId : null
                      return (
                        <tr key={l._id}>
                          <td>{nameOf(l.clientId)}</td>
                          <td>{firstContactEmail(cl?.contactPersons) || cl?.email || '—'}</td>
                          <td>{l.notes || '—'}</td>
                          <td>
                            {canDelete && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => void removeClientLink(l._id)}
                              >
                                Unlink
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {canEdit && (
              <div className="products-toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
                <div className="field" style={{ minWidth: 220 }}>
                  <select value={clientPick} onChange={(e) => setClientPick(e.target.value)} aria-label="Client to link">
                    <option value="">Link a client…</option>
                    {clients
                      .filter((c) => !linkedClientIds.has(c._id))
                      .map((c) => (
                        <option key={c._id} value={c._id}>
                          {c.companyName}
                        </option>
                      ))}
                  </select>
                </div>
                <input
                  type="text"
                  placeholder="Notes (optional)"
                  value={clientNotes}
                  onChange={(e) => setClientNotes(e.target.value)}
                />
                <button type="button" className="btn" disabled={!clientPick || busy} onClick={() => void addClientLink()}>
                  Link client
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}