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
import { applyDialCode, applyDialToContactPhones } from '@/lib/countries'
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
import { formatDate, idOf, nameOf } from '@/lib/utils'
import type { Client, ContactPerson, Product } from '@/types'

type SortKey = 'companyName' | 'country' | 'city' | 'contacts' | 'createdAt'

type ProductLink = {
  _id: string
  productId?: Product | string | null
  clientId?: Client | string | null
  notes?: string
  createdAt?: string
}

type FormState = {
  companyName: string
  country: string
  address: string
  postCode: string
  city: string
  province: string
  tel: string
  mobile: string
  email: string
  web: string
  wechat: string
  facebook: string
  whatsapp: string
  others: string
  notes: string
  ntnNumber: string
  contacts: ContactPerson[]
}

const EMPTY_FORM: FormState = {
  companyName: '',
  country: '',
  address: '',
  postCode: '',
  city: '',
  province: '',
  tel: '',
  mobile: '',
  email: '',
  web: '',
  wechat: '',
  facebook: '',
  whatsapp: '',
  others: '',
  notes: '',
  ntnNumber: '',
  contacts: [emptyContact()],
}

function formFromClient(c: Client): FormState {
  return {
    companyName: c.companyName || '',
    country: c.country || '',
    address: c.address || '',
    postCode: c.postCode || '',
    city: c.city || '',
    province: c.province || '',
    tel: c.tel || '',
    mobile: c.mobile || '',
    email: c.email || '',
    web: c.web || '',
    wechat: c.wechat || '',
    facebook: c.facebook || '',
    whatsapp: c.whatsapp || '',
    others: c.others || '',
    notes: c.notes || '',
    ntnNumber: c.ntnNumber || '',
    contacts:
      c.contactPersons && c.contactPersons.length
        ? c.contactPersons.map((p) => ({ ...emptyContact(), ...p }))
        : [emptyContact()],
  }
}

export default function ClientsPage() {
  const { canEdit, canDelete, canEmail } = useAuth()
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const { search, setSearch, highlightId } = useUrlSearch()
  const [countryFilter, setCountryFilter] = useState('')
  const sort = useSort<SortKey>('companyName')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Client | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [ntnFile, setNtnFile] = useState<File | null>(null)
  const [removeNtn, setRemoveNtn] = useState(false)
  const [saving, setSaving] = useState(false)
  const [allProducts, setAllProducts] = useState<Product[]>([])
  const [productDrafts, setProductDrafts] = useState<DraftProductLink[]>([])

  const [detail, setDetail] = useState<Client | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setClients(unwrapList<Client>(await api<unknown>('/api/clients')))
    } catch (err) {
      toast(errorMessage(err, 'Failed to load clients'), 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const countries = useMemo(
    () =>
      [...new Set(clients.map((c) => (c.country || '').trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [clients],
  )

  const filtered = useMemo(() => {
    const list = clients.filter((c) => {
      if (countryFilter && (c.country || '').trim() !== countryFilter) return false
      return includesText(
        [
          c.companyName,
          c.country,
          c.city,
          c.province,
          c.address,
          c.email,
          c.tel,
          c.mobile,
          c.ntnNumber,
          c.web,
          contactSearchBlob(c.contactPersons),
        ],
        search,
      )
    })
    const accessor = (c: Client): unknown => {
      switch (sort.key) {
        case 'country':
          return c.country
        case 'city':
          return c.city
        case 'contacts':
          return contactsSummary(c.contactPersons)
        case 'createdAt':
          return c.createdAt ? new Date(c.createdAt).getTime() : 0
        default:
          return c.companyName
      }
    }
    const mult = sort.dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => mult * compareValues(accessor(a), accessor(b)))
  }, [clients, search, countryFilter, sort.key, sort.dir])

  const selection = useSelection(filtered)

  async function deleteSelected() {
    if (!selection.count) return
    if (!window.confirm(`Delete ${selection.count} selected client(s)? This cannot be undone.`)) return
    try {
      for (const id of selection.selectedIds) {
        await api(`/api/clients/${id}`, { method: 'DELETE' })
      }
      toast(`Deleted ${selection.count} client(s)`, 'success')
      selection.clear()
      await load()
    } catch (err) {
      toast(errorMessage(err, 'Bulk delete failed'), 'error')
    }
  }

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setNtnFile(null)
    setRemoveNtn(false)
    setProductDrafts([])
    setFormOpen(true)
  }

  const openEdit = useCallback((c: Client) => {
    setEditing(c)
    setForm(formFromClient(c))
    setNtnFile(null)
    setRemoveNtn(false)
    setProductDrafts([])
    setFormOpen(true)
  }, [])

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
      tel: applyDialCode(f.tel, dial),
      mobile: applyDialCode(f.mobile, dial),
      whatsapp: f.whatsapp ? applyDialCode(f.whatsapp, dial) : f.whatsapp,
      contacts: f.contacts.map((c) => applyDialToContactPhones(c, dial)),
    }))
  }

  async function saveProductDrafts(clientId: string) {
    for (const d of productDrafts) {
      try {
        await api('/api/product-clients', {
          method: 'POST',
          body: JSON.stringify({
            productId: d.productId,
            clientId,
            notes: d.notes.trim() || undefined,
          }),
        })
      } catch {
        /* skip duplicates / errors so create still succeeds */
      }
    }
  }

  useEffect(() => {
    if (searchParams.get('new') !== '1' || loading) return
    if (canEdit) openCreate()
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
  }, [searchParams, canEdit, loading, setSearchParams, openCreate])

  function buildFormData(skipDuplicateCheck = false) {
    const fd = new FormData()
    fd.append('companyName', form.companyName.trim())
    fd.append('country', form.country.trim())
    fd.append('contactPersons', JSON.stringify(cleanContacts(form.contacts)))
    for (const key of [
      'address',
      'postCode',
      'city',
      'province',
      'tel',
      'mobile',
      'email',
      'web',
      'wechat',
      'facebook',
      'whatsapp',
      'others',
      'notes',
      'ntnNumber',
    ] as const) {
      fd.append(key, form[key].trim())
    }
    if (ntnFile) fd.append('ntnFile', ntnFile)
    if (editing && removeNtn && !ntnFile) fd.append('removeNtnFile', '1')
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
        await apiForm(`/api/clients/${editing._id}`, buildFormData(), 'PUT')
        toast('Client updated', 'success')
      } else {
        let created: { client?: Client } | null = null
        try {
          created = await apiForm<{ client?: Client }>('/api/clients', buildFormData(), 'POST')
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            if (!window.confirm(`${err.message}. Create it anyway?`)) {
              setSaving(false)
              return
            }
            created = await apiForm<{ client?: Client }>('/api/clients', buildFormData(true), 'POST')
          } else {
            throw err
          }
        }
        if (created?.client?._id && productDrafts.length) {
          await saveProductDrafts(created.client._id)
        }
        toast('Client created', 'success')
      }
      setProductDrafts([])
      setFormOpen(false)
      await load()
    } catch (err) {
      toast(errorMessage(err, 'Failed to save client'), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(c: Client) {
    if (!window.confirm(`Delete client “${c.companyName}”? This cannot be undone.`)) return
    try {
      await api(`/api/clients/${c._id}`, { method: 'DELETE' })
      toast('Client deleted', 'success')
      if (detail?._id === c._id) setDetail(null)
      await load()
    } catch (err) {
      toast(errorMessage(err, 'Delete failed'), 'error')
    }
  }

  async function dismissNew(c: Client) {
    try {
      await api(`/api/clients/${c._id}`, { method: 'PUT', body: JSON.stringify({ showAsNew: false }) })
      setClients((prev) => prev.map((x) => (x._id === c._id ? { ...x, showAsNew: false } : x)))
    } catch (err) {
      toast(errorMessage(err, 'Could not dismiss'), 'error')
    }
  }

  const set = (key: keyof FormState) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  useEffect(() => {
    document.title = 'Clients | TRI Dashboard'
  }, [])

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Data</p>
          <h1>Clients</h1>
          <p className="page-lede">Buyers you sell to — contacts, NTN, and linked products.</p>
        </div>
      </header>

      <div className="clients-toolbar list-toolbar">
        <div className="toolbar-row">
          <div className="toolbar-group toolbar-search">
            <label htmlFor="clientSearchInput">Search</label>
            <input
              type="search"
              id="clientSearchInput"
              placeholder="Company, city, country…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="toolbar-group toolbar-compact">
            <label htmlFor="sortClients">Sort by</label>
            <select
              id="sortClients"
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
              <EntityImportPanel type="clients" onDone={() => void load()} />
              <button
                type="button"
                className="btn toolbar-cta"
                id="toggleFormBtn"
                onClick={() => {
                  if (formOpen && !editing) setFormOpen(false)
                  else openCreate()
                }}
              >
                {formOpen && !editing ? 'Close form' : 'Add client'}
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
            const c = filtered.find((x) => x._id === selection.selectedIds[0])
            if (c) openEdit(c)
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
        <Link
          className={`btn btn-secondary btn-sm${canEmail && selection.count ? '' : ' is-disabled'}`}
          to={
            selection.count
              ? `/mail?recipientType=client&recipientIds=${selection.selectedIds.join(',')}`
              : '/mail?recipientType=client'
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
        id="clientForm"
        className={`form-container entity-form${formOpen ? ' show' : ''}`}
        style={{ display: formOpen ? 'block' : 'none' }}
        onSubmit={onSubmit}
        noValidate
      >
        <div className="form-grid">
          <div className="field">
            <label htmlFor="clientCompanyName">Company Name</label>
            <input
              type="text"
              name="companyName"
              id="clientCompanyName"
              required
              autoComplete="organization"
              value={form.companyName}
              onChange={set('companyName')}
            />
          </div>
          <div className="field">
            <label htmlFor="clientCountry">Country</label>
            <CountryPicker
              id="clientCountry"
              name="country"
              value={form.country}
              onChange={(country) => setForm({ ...form, country })}
              onSelect={onCountrySelect}
            />
          </div>
        </div>
        <p className="form-hint">Selecting a country fills the phone dial code automatically.</p>

        <div className="form-section">
          <div className="form-section-title">Contact person(s)</div>
          <p className="form-hint">Add name and email for each contact. Extra contacts are optional.</p>
          <div id="clientContactsWidget">
            <ContactsEditor value={form.contacts} onChange={(contacts) => setForm({ ...form, contacts })} />
          </div>
        </div>

        <div className="form-section">
          <div className="form-section-title">Address &amp; details</div>
          <div className="form-grid">
            <div className="field span-2">
              <label htmlFor="clientAddress">Address</label>
              <textarea id="clientAddress" name="address" rows={2} value={form.address} onChange={set('address')} />
            </div>
            <div className="field">
              <label htmlFor="clientPostCode">Post Code</label>
              <input id="clientPostCode" type="text" name="postCode" value={form.postCode} onChange={set('postCode')} />
            </div>
            <div className="field">
              <label htmlFor="clientCity">City</label>
              <input id="clientCity" type="text" name="city" value={form.city} onChange={set('city')} />
            </div>
            <div className="field">
              <label htmlFor="clientProvince">Province</label>
              <input id="clientProvince" type="text" name="province" value={form.province} onChange={set('province')} />
            </div>
            <div className="field">
              <label htmlFor="clientTel">Tel</label>
              <input id="clientTel" type="text" name="tel" value={form.tel} onChange={set('tel')} />
            </div>
            <div className="field">
              <label htmlFor="clientMobile">Mobile</label>
              <input id="clientMobile" type="text" name="mobile" value={form.mobile} onChange={set('mobile')} />
            </div>
            <div className="field">
              <label htmlFor="clientWeb">Web</label>
              <input id="clientWeb" type="text" name="web" value={form.web} onChange={set('web')} />
            </div>
            <div className="field">
              <label htmlFor="clientWechat">WeChat</label>
              <input id="clientWechat" type="text" name="wechat" value={form.wechat} onChange={set('wechat')} />
            </div>
            <div className="field">
              <label htmlFor="clientFacebook">Facebook</label>
              <input id="clientFacebook" type="text" name="facebook" value={form.facebook} onChange={set('facebook')} />
            </div>
            <div className="field">
              <label htmlFor="clientWhatsapp">WhatsApp</label>
              <input id="clientWhatsapp" type="text" name="whatsapp" value={form.whatsapp} onChange={set('whatsapp')} />
            </div>
            <div className="field span-2">
              <label htmlFor="clientOthers">Other social</label>
              <textarea id="clientOthers" name="others" rows={2} value={form.others} onChange={set('others')} />
            </div>
            <div className="field span-2">
              <label htmlFor="clientNotes">Notes</label>
              <textarea
                id="clientNotes"
                name="notes"
                rows={2}
                placeholder="Optional notes about this client"
                value={form.notes}
                onChange={set('notes')}
              />
            </div>
            <div className="field">
              <label htmlFor="clientNtnNumber">NTN #</label>
              <input
                id="clientNtnNumber"
                type="text"
                name="ntnNumber"
                placeholder="National Tax Number"
                autoComplete="off"
                value={form.ntnNumber}
                onChange={set('ntnNumber')}
              />
            </div>
            <div className="field">
              <label htmlFor="clientNtnFile">NTN file</label>
              <input id="clientNtnFile" type="file" name="ntnFile" onChange={(e) => setNtnFile(e.target.files?.[0] || null)} />
              <small className="form-hint">Saved as [Client company]-NTN</small>
            </div>
          </div>
          {editing?.ntnFile ? (
            <div className="existing-files-hint">
              <label className="checkbox-row">
                <input type="checkbox" checked={removeNtn} onChange={(e) => setRemoveNtn(e.target.checked)} />
                Remove current file:{' '}
                <a href={uploadUrl(editing.ntnFile)} target="_blank" rel="noreferrer">
                  {displayFileName(editing.ntnFile)}
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
            disabled={saving || !canEdit}
            title="Linked products (optional)"
          />
        ) : null}

        <div className="form-actions">
          <button type="submit" className="btn btn-sm" id="clientSubmitBtn" disabled={saving || !canEdit}>
            {saving ? 'Saving…' : editing ? 'Save client' : 'Save client'}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
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
        <div className="loading-block">Loading clients…</div>
      ) : (
        <div className="table-wrap">
          <table className="data clients-table">
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
                <th>Notes</th>
                <th>NTN #</th>
                <th>NTN File</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr className="mobile-empty-row">
                  <td colSpan={10}>
                    {clients.length === 0 ? 'No clients yet.' : 'No clients match your filters.'}
                  </td>
                </tr>
              ) : (
                filtered.map((c) => {
                  const email =
                    c.email || (c.contactPersons || []).map((p) => p.email).find(Boolean) || '—'
                  return (
                    <tr
                      key={c._id}
                      className={
                        highlightId === c._id || selection.has(c._id) ? 'is-selected is-highlight' : undefined
                      }
                    >
                      <td className="checkbox-col">
                        <input
                          type="checkbox"
                          checked={selection.has(c._id)}
                          onChange={() => selection.toggle(c._id)}
                        />
                      </td>
                      <td className="mobile-card-primary">
                        <div className="avatar-chip">
                          <span className={`avatar-circle tone-${(c.companyName || '').length % 6}`}>
                            {(c.companyName || '?')
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
                              onClick={() => setDetail(c)}
                            >
                              {c.companyName || '—'}
                            </button>
                            <div className="entity-sub">
                              {[c.city, c.country].filter(Boolean).join(', ') || 'No location'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td data-label="Contacts">{contactsSummary(c.contactPersons) || '—'}</td>
                      <td data-label="City">{c.city || '—'}</td>
                      <td data-label="Country">{c.country || '—'}</td>
                      <td data-label="Email">{email}</td>
                      <td data-label="Notes">{c.notes || '—'}</td>
                      <td data-label="NTN">{c.ntnNumber || '—'}</td>
                      <td data-label="NTN File">
                        {c.ntnFile ? (
                          <a href={uploadUrl(c.ntnFile)} target="_blank" rel="noreferrer">
                            {displayFileName(c.ntnFile)}
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="table-actions-cell client-actions-cell" data-label="Actions">
                        <RowActionsMenu
                          items={[
                            { label: 'View', onClick: () => setDetail(c) },
                            { label: 'Edit', onClick: () => openEdit(c), hidden: !canEdit },
                            {
                              label: 'Email',
                              href: `/mail?recipientType=client&recipientId=${c._id}`,
                              hidden: !canEmail,
                            },
                            { label: 'Delete', onClick: () => void onDelete(c), danger: true, hidden: !canDelete },
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
        <ClientDetail
          client={detail}
          onClose={() => setDetail(null)}
          onEdit={() => {
            const c = detail
            setDetail(null)
            openEdit(c)
          }}
        />
      ) : null}
    </>
  )
}

function ClientDetail({
  client: initial,
  onClose,
  onEdit,
}: {
  client: Client
  onClose: () => void
  onEdit: () => void
}) {
  const { canEdit, canDelete, canEmail } = useAuth()
  const { toast } = useToast()
  const [client, setClient] = useState(initial)

  const [links, setLinks] = useState<ProductLink[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [pick, setPick] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [editLink, setEditLink] = useState<ProductLink | null>(null)
  const [editNotes, setEditNotes] = useState('')

  useEffect(() => {
    setClient(initial)
  }, [initial])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const fresh = await api<Client>(`/api/clients/${initial._id}`)
        if (!cancelled && fresh?._id) setClient(fresh)
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
      const data = await api<ProductLink[]>(`/api/clients/${client._id}/products`)
      setLinks(Array.isArray(data) ? data : [])
    } catch (err) {
      toast(errorMessage(err, 'Failed to load linked products'), 'error')
    } finally {
      setLoading(false)
    }
  }, [client._id, toast])

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

  async function addLink() {
    if (!pick) return
    setBusy(true)
    try {
      await api('/api/product-clients', {
        method: 'POST',
        body: JSON.stringify({ productId: pick, clientId: client._id, notes: notes.trim() || undefined }),
      })
      setPick('')
      setNotes('')
      toast('Product linked', 'success')
      await loadLinks()
    } catch (err) {
      toast(errorMessage(err, 'Could not link product'), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit() {
    if (!editLink) return
    setBusy(true)
    try {
      await api(`/api/product-clients/${editLink._id}`, {
        method: 'PUT',
        body: JSON.stringify({ notes: editNotes }),
      })
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
    if (!window.confirm(`Unlink ${nameOf(l.productId)} from this client?`)) return
    try {
      await api(`/api/product-clients/${l._id}`, { method: 'DELETE' })
      toast('Link removed', 'success')
      await loadLinks()
    } catch (err) {
      toast(errorMessage(err, 'Could not remove link'), 'error')
    }
  }

  const contacts = client.contactPersons || []
  const socials = [
    client.whatsapp && `WhatsApp: ${client.whatsapp}`,
    client.wechat && `WeChat: ${client.wechat}`,
    client.facebook && `Facebook: ${client.facebook}`,
    client.others,
  ].filter(Boolean)

  return (
    <Modal
      large
      title={client.companyName || 'Client'}
      onClose={onClose}
      footer={
        <>
          {canEmail && (
            <Link
              className="action-btn"
              to={`/mail?recipientType=client&recipientId=${client._id}&template=product-details-pricing`}
            >
              Email client
            </Link>
          )}
          {canEdit && (
            <Link className="action-btn" to={`/quotes?new=1&clientId=${client._id}`}>
              New quotation
            </Link>
          )}
          {canEdit && (
            <button type="button" className="btn" onClick={onEdit}>
              Edit client
            </button>
          )}
        </>
      }
    >
      <div className="form-grid" style={{ marginBottom: 18 }}>
        <Info label="Country">{client.country || '—'}</Info>
        <Info label="City / province">{[client.city, client.province].filter(Boolean).join(', ') || '—'}</Info>
        <Info label="Post code">{client.postCode || '—'}</Info>
        <Info label="Email">{client.email || '—'}</Info>
        <Info label="Telephone">{client.tel || '—'}</Info>
        <Info label="Mobile">{client.mobile || '—'}</Info>
        <Info label="Website">{client.web || '—'}</Info>
        <Info label="NTN number">{client.ntnNumber || '—'}</Info>
        <div className="span-2">
          <Info label="Address">{client.address || '—'}</Info>
        </div>
        <div className="span-2">
          <Info label="Socials / other">{socials.length ? socials.join(' · ') : '—'}</Info>
        </div>
        <div className="span-2">
          <Info label="NTN file">
            {client.ntnFile ? (
              <a href={uploadUrl(client.ntnFile)} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                {displayFileName(client.ntnFile)}
              </a>
            ) : (
              '—'
            )}
          </Info>
        </div>
        <div className="span-2">
          <Info label="Notes">{client.notes || '—'}</Info>
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
                  <th>Notes</th>
                  <th>Linked</th>
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
                      <td>{l.notes || '—'}</td>
                      <td>{formatDate(l.createdAt)}</td>
                      <td>
                        <div className="row-actions">
                          {canEdit && (
                            <button
                              type="button"
                              className="action-btn"
                              onClick={() => {
                                setEditLink(l)
                                setEditNotes(l.notes || '')
                              }}
                            >
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
          <div className="products-toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
            <div className="field" style={{ minWidth: 240 }}>
              <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Product to link">
                <option value="">Link a product…</option>
                {products
                  .filter((p) => !linkedIds.has(p._id))
                  .map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </div>
            <input type="text" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <button type="button" className="btn" disabled={!pick || busy} onClick={() => void addLink()}>
              Link product
            </button>
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
              <button type="button" className="btn" disabled={busy} onClick={() => void saveEdit()}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          <div className="field">
            <label>Notes</label>
            <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
          </div>
        </Modal>
      )}
    </Modal>
  )
}
