import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { errorMessage, includesText, unwrapList } from '@/lib/entity'
import type { Client, ContactPerson, EmailTemplate, Product, Supplier } from '@/types'

type RecipientType = 'supplier' | 'client'

type FieldDef = {
  label: string
  type?: 'text' | 'number' | 'textarea'
  placeholder?: string
}

type Template = EmailTemplate & { fieldDefs?: Record<string, FieldDef> }

type Entity = {
  _id?: string
  recipientId?: string
  companyName?: string
  contactPersons?: ContactPerson[]
  email?: string
}

type MailContext = {
  settings?: {
    defaultCurrency?: string
    defaultImportDuty?: number
    defaultIncomeTax?: number
    defaultSalesTax?: number
  }
  product?: Product | null
  recipients?: Array<Entity & { recipientType: RecipientType }>
  linkedProducts?: Product[]
}

type RecipientRow = {
  key: string
  recipientType: RecipientType
  recipientId: string
  toEmail: string
  companyName: string
  contactName: string
}

type SendResponse = { message?: string; sent?: number; errors?: string[] }

const FALLBACK_DEFS: Record<string, FieldDef> = {
  price: { label: 'Price', type: 'text', placeholder: 'e.g. 1500' },
  currency: { label: 'Currency', type: 'text', placeholder: 'USD' },
  importDuty: { label: 'Import duty (%)', type: 'number', placeholder: '0' },
  incomeTax: { label: 'Income tax (%)', type: 'number', placeholder: '0' },
  salesTax: { label: 'Sales tax (%)', type: 'number', placeholder: '0' },
  customMessage: { label: 'Email body', type: 'textarea', placeholder: 'Write your message…' },
  subjectLine: { label: 'Subject', type: 'text', placeholder: 'Email subject' },
}

function expandRecipients(entities: Entity[], type: RecipientType): RecipientRow[] {
  const rows: RecipientRow[] = []
  for (const entity of entities) {
    const id = String(entity._id || entity.recipientId || '')
    if (!id) continue
    const company = entity.companyName || '—'
    let added = false
    ;(entity.contactPersons || []).forEach((cp, idx) => {
      const email = (cp?.email || '').trim()
      if (!email) return
      added = true
      rows.push({
        key: `${type}:${id}:${email}`,
        recipientType: type,
        recipientId: id,
        toEmail: email,
        companyName: company,
        contactName: (cp.name || '').trim() || `Contact ${idx + 1}`,
      })
    })
    const companyEmail = (entity.email || '').trim()
    if (!added && companyEmail) {
      rows.push({
        key: `${type}:${id}:${companyEmail}`,
        recipientType: type,
        recipientId: id,
        toEmail: companyEmail,
        companyName: company,
        contactName: 'Company',
      })
    }
  }
  return rows
}

function splitIds(value: string | null) {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export default function MailPage() {
  useEffect(() => { document.title = 'Mail Center'; }, [])

  const { canEmail } = useAuth()
  const { toast } = useToast()
  const [params] = useSearchParams()

  const urlType: RecipientType = params.get('recipientType') === 'client' ? 'client' : 'supplier'
  const urlRecipientIds = useMemo(
    () => [...splitIds(params.get('recipientId')), ...splitIds(params.get('recipientIds'))],
    [params],
  )
  const urlProductIds = useMemo(
    () => [...splitIds(params.get('productId')), ...splitIds(params.get('productIds'))],
    [params],
  )
  const urlTemplate = params.get('template')
  const urlToEmail = params.get('toEmail')

  const [loading, setLoading] = useState(true)
  const [templates, setTemplates] = useState<Template[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [products, setProducts] = useState<Product[]>([])

  const [recipientType, setRecipientType] = useState<RecipientType>(urlType)
  const [templateId, setTemplateId] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [selectedProducts, setSelectedProducts] = useState<string[]>(urlProductIds)
  const [userFields, setUserFields] = useState<Record<string, string>>({})
  const [context, setContext] = useState<MailContext | null>(null)
  const [onlyLinked, setOnlyLinked] = useState(true)

  const [recipientSearch, setRecipientSearch] = useState('')
  const [productSearch, setProductSearch] = useState('')

  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [sending, setSending] = useState(false)

  // --- initial lookups ---
  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [t, s, c, p] = await Promise.all([
        api<Template[]>('/api/email-templates'),
        api<unknown>('/api/suppliers'),
        api<unknown>('/api/clients'),
        api<unknown>('/api/products'),
      ])
      const tpls = Array.isArray(t) ? t : []
      setTemplates(tpls)
      setSuppliers(unwrapList<Supplier>(s))
      setClients(unwrapList<Client>(c))
      setProducts(unwrapList<Product>(p))
    } catch (err) {
      toast(errorMessage(err, 'Failed to load mail data'), 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  // --- context (product- or recipient-scoped) ---
  const contextProductId = urlProductIds[0] || ''
  const contextRecipientId = urlRecipientIds[0] || ''
  useEffect(() => {
    if (!contextProductId && !(contextRecipientId && recipientType === urlType)) {
      setContext(null)
      return
    }
    let cancelled = false
    const q = new URLSearchParams()
    if (contextProductId) q.set('productId', contextProductId)
    q.set('recipientType', recipientType)
    if (!contextProductId && contextRecipientId) q.set('recipientId', contextRecipientId)
    api<MailContext>(`/api/mail/context?${q.toString()}`)
      .then((data) => {
        if (!cancelled) setContext(data)
      })
      .catch((err) => {
        if (!cancelled) {
          setContext(null)
          toast(errorMessage(err, 'Failed to load mail context'), 'error')
        }
      })
    return () => {
      cancelled = true
    }
  }, [contextProductId, contextRecipientId, recipientType, urlType, toast])

  // --- templates available for the chosen recipient type ---
  const availableTemplates = useMemo(
    () =>
      templates.filter(
        (t) =>
          !t.recipientTypes?.length || t.recipientTypes.includes('any') || t.recipientTypes.includes(recipientType),
      ),
    [templates, recipientType],
  )

  useEffect(() => {
    if (!availableTemplates.length) {
      setTemplateId('')
      return
    }
    setTemplateId((current) => {
      if (current && availableTemplates.some((t) => t._id === current)) return current
      const fromUrl = urlTemplate
        ? availableTemplates.find((t) => t.slug === urlTemplate || t._id === urlTemplate)
        : undefined
      return (fromUrl || availableTemplates[0])._id
    })
  }, [availableTemplates, urlTemplate])

  const template = useMemo(() => availableTemplates.find((t) => t._id === templateId) || null, [availableTemplates, templateId])

  // --- recipients ---
  const linkedRows = useMemo(() => {
    const linked = (context?.recipients || []).filter((r) => r.recipientType === recipientType)
    return linked.length ? expandRecipients(linked, recipientType) : []
  }, [context, recipientType])

  const allRows = useMemo(
    () => expandRecipients((recipientType === 'supplier' ? suppliers : clients) as Entity[], recipientType),
    [recipientType, suppliers, clients],
  )

  const restrictIds = recipientType === urlType ? urlRecipientIds : []

  const baseRows = useMemo(() => {
    let rows = linkedRows.length && onlyLinked ? linkedRows : allRows
    if (restrictIds.length) {
      const set = new Set(restrictIds)
      rows = rows.filter((r) => set.has(r.recipientId))
    }
    return rows
  }, [linkedRows, allRows, onlyLinked, restrictIds])

  const visibleRows = useMemo(
    () => baseRows.filter((r) => includesText([r.companyName, r.contactName, r.toEmail], recipientSearch)),
    [baseRows, recipientSearch],
  )

  // preselect from URL once recipient rows are available
  const [preselected, setPreselected] = useState(false)
  useEffect(() => {
    if (preselected || loading) return
    if (recipientType !== urlType) return
    if (!restrictIds.length) {
      setPreselected(true)
      return
    }
    if (!baseRows.length) return
    const keys: string[] = []
    if (urlToEmail) {
      const hit = baseRows.find((r) => r.toEmail.toLowerCase() === urlToEmail.toLowerCase())
      if (hit) keys.push(hit.key)
    } else {
      const seen = new Set<string>()
      for (const r of baseRows) {
        if (seen.has(r.recipientId)) continue
        seen.add(r.recipientId)
        keys.push(r.key)
      }
    }
    setSelected(keys)
    setPreselected(true)
  }, [preselected, loading, recipientType, urlType, restrictIds, baseRows, urlToEmail])

  function changeRecipientType(next: RecipientType) {
    if (next === recipientType) return
    setRecipientType(next)
    setSelected([])
    setRecipientSearch('')
    setPreselected(true)
  }

  function toggleRow(key: string) {
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  function toggleAllVisible() {
    const keys = visibleRows.map((r) => r.key)
    const all = keys.length > 0 && keys.every((k) => selected.includes(k))
    setSelected((prev) => (all ? prev.filter((k) => !keys.includes(k)) : [...new Set([...prev, ...keys])]))
  }

  const selectedRows = useMemo(() => {
    const map = new Map([...allRows, ...linkedRows].map((r) => [r.key, r]))
    return selected.map((k) => map.get(k)).filter((r): r is RecipientRow => Boolean(r))
  }, [selected, allRows, linkedRows])

  // --- products ---
  const linkedProductIds = useMemo(
    () => new Set((context?.linkedProducts || []).map((p) => p._id)),
    [context],
  )

  const visibleProducts = useMemo(
    () => products.filter((p) => includesText([p.name, p.hsCode], productSearch)),
    [products, productSearch],
  )

  function toggleProduct(id: string) {
    setSelectedProducts((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  // --- template fields ---
  const fieldKeys = useMemo(() => template?.requiredFields || [], [template])
  const defs = useMemo(() => ({ ...FALLBACK_DEFS, ...(template?.fieldDefs || {}) }), [template])

  const autoDefaults = useMemo(() => {
    const firstProduct =
      products.find((p) => p._id === selectedProducts[0]) ||
      (context?.product && context.product._id === selectedProducts[0] ? context.product : null) ||
      null
    const s = context?.settings
    const pick = (a: number | undefined | null, b: number | undefined | null) => {
      const v = a ?? b
      return v == null ? '' : String(v)
    }
    return {
      currency: s?.defaultCurrency || 'USD',
      importDuty: pick(firstProduct?.importDuty, s?.defaultImportDuty),
      incomeTax: pick(firstProduct?.incomeTax, s?.defaultIncomeTax),
      salesTax: pick(firstProduct?.salesTax, s?.defaultSalesTax),
    } as Record<string, string>
  }, [products, selectedProducts, context])

  const effectiveFields = useMemo(() => {
    const out: Record<string, string> = {}
    for (const key of fieldKeys) {
      const v = userFields[key] ?? autoDefaults[key] ?? ''
      if (String(v).trim() !== '') out[key] = String(v)
    }
    return out
  }, [fieldKeys, userFields, autoDefaults])

  const requiresBody = fieldKeys.includes('subjectLine') && fieldKeys.includes('customMessage')

  // --- preview (debounced) ---
  const previewKey = useMemo(
    () =>
      JSON.stringify({
        t: template?._id,
        r: selectedRows[0]?.key,
        p: selectedProducts,
        f: effectiveFields,
      }),
    [template, selectedRows, selectedProducts, effectiveFields],
  )
  const debouncedPreviewKey = useDebouncedValue(previewKey, 450)

  useEffect(() => {
    const tpl = template
    const first = selectedRows[0]
    if (!tpl || !first) {
      setPreview(null)
      setPreviewError('')
      return
    }
    let cancelled = false
    setPreviewLoading(true)
    api<{ subject: string; html: string }>('/api/mail/preview', {
      method: 'POST',
      body: JSON.stringify({
        templateId: tpl._id,
        recipientType: first.recipientType,
        recipientId: first.recipientId,
        toEmail: first.toEmail,
        productIds: selectedProducts.length ? selectedProducts : undefined,
        fields: effectiveFields,
      }),
    })
      .then((data) => {
        if (cancelled) return
        setPreview(data)
        setPreviewError('')
      })
      .catch((err) => {
        if (cancelled) return
        setPreview(null)
        setPreviewError(errorMessage(err, 'Preview failed'))
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedPreviewKey])

  // --- send ---
  async function onSend() {
    if (!canEmail) return
    if (!template) return toast('Select a template', 'error')
    if (!selectedRows.length) return toast('Select at least one recipient', 'error')
    if (requiresBody) {
      if (!(effectiveFields.subjectLine || '').trim()) return toast('Enter an email subject', 'error')
      if (!(effectiveFields.customMessage || '').trim()) return toast('Write the email body', 'error')
    }
    if (
      selectedRows.length > 1 &&
      !window.confirm(`Send this email to ${selectedRows.length} recipients?`)
    ) {
      return
    }
    setSending(true)
    try {
      const res = await api<SendResponse>('/api/mail/send-batch', {
        method: 'POST',
        body: JSON.stringify({
          templateId: template._id,
          sends: selectedRows.map((r) => ({
            recipientType: r.recipientType,
            recipientId: r.recipientId,
            toEmail: r.toEmail,
            productIds: selectedProducts.length ? selectedProducts : undefined,
            fields: effectiveFields,
          })),
        }),
      })
      toast(res?.message || 'Email sent', 'success')
      if (res?.errors?.length) toast(`Some emails failed: ${res.errors.join('. ')}`, 'error')
    } catch (err) {
      toast(errorMessage(err, 'Send failed'), 'error')
    } finally {
      setSending(false)
    }
  }

  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.includes(r.key))

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Comms</div>
          <h1>Mail</h1>
          <p className="page-lede">
            Compose from a template, pick recipients and products, preview the rendered email, then send.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="loading-block">Loading mail data…</div>
      ) : (
        <div className="mail-layout">
          <div className="mail-stack">
            <div className="panel">
              <div className="panel-title">1. Template &amp; audience</div>
              <div className="form-grid">
                <div className="field span-2">
                  <label>Send to</label>
                  <div className="tabs" style={{ marginBottom: 0 }}>
                    <button
                      type="button"
                      className={`tab ${recipientType === 'supplier' ? 'active' : ''}`}
                      onClick={() => changeRecipientType('supplier')}
                    >
                      Suppliers
                    </button>
                    <button
                      type="button"
                      className={`tab ${recipientType === 'client' ? 'active' : ''}`}
                      onClick={() => changeRecipientType('client')}
                    >
                      Clients
                    </button>
                  </div>
                </div>
                <div className="field span-2">
                  <label htmlFor="m-template">Template</label>
                  <select id="m-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                    {availableTemplates.length === 0 && <option value="">No templates available</option>}
                    {availableTemplates.map((t) => (
                      <option key={t._id} value={t._id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  {template?.description && (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{template.description}</span>
                  )}
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-title">
                2. Recipients{' '}
                <span className="badge badge-accent" style={{ marginLeft: 6 }}>
                  {selectedRows.length} selected
                </span>
              </div>
              <div className="products-toolbar list-toolbar" style={{ marginBottom: 10 }}>
                <div className="toolbar-row">
                  <div className="toolbar-group toolbar-search">
                    <label htmlFor="mailRecipientSearch">Search</label>
                    <input
                      id="mailRecipientSearch"
                      type="search"
                      placeholder="Company, contact or email…"
                      value={recipientSearch}
                      onChange={(e) => setRecipientSearch(e.target.value)}
                      aria-label="Search recipients"
                    />
                  </div>
                  <div className="toolbar-actions">
                    <button type="button" className="action-btn" onClick={toggleAllVisible}>
                      {allVisibleSelected ? 'Clear visible' : 'Select visible'}
                    </button>
                  </div>
                </div>
                {linkedRows.length > 0 && !restrictIds.length ? (
                  <label className="checkbox-row" style={{ marginTop: 8 }}>
                    <input type="checkbox" checked={onlyLinked} onChange={(e) => setOnlyLinked(e.target.checked)} />
                    Linked to product only
                  </label>
                ) : null}
              </div>
              <div className="mail-list-box">
                {visibleRows.length === 0 ? (
                  <div className="empty-state" style={{ padding: 20 }}>
                    No {recipientType}s with an email address{recipientSearch ? ' match your search' : ''}.
                  </div>
                ) : (
                  visibleRows.map((r) => (
                    <label key={r.key} className="mail-pick-row">
                      <input type="checkbox" checked={selected.includes(r.key)} onChange={() => toggleRow(r.key)} />
                      <span className="mail-pick-body">
                        <strong>{r.companyName}</strong>
                        <span className="mail-pick-meta">{r.contactName}</span>
                        <span className="mail-pick-email">{r.toEmail}</span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="panel">
              <div className="panel-title">
                3. Products{' '}
                <span className="badge" style={{ marginLeft: 6 }}>
                  {selectedProducts.length} selected
                </span>
              </div>
              <div className="products-toolbar list-toolbar" style={{ marginBottom: 10 }}>
                <div className="toolbar-row">
                  <div className="toolbar-group toolbar-search">
                    <label htmlFor="mailProductSearch">Search</label>
                    <input
                      id="mailProductSearch"
                      type="search"
                      placeholder="Search products…"
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      aria-label="Search products"
                    />
                  </div>
                  {selectedProducts.length > 0 ? (
                    <div className="toolbar-actions">
                      <button type="button" className="action-btn" onClick={() => setSelectedProducts([])}>
                        Clear
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="mail-list-box" style={{ maxHeight: 240 }}>
                {visibleProducts.length === 0 ? (
                  <div className="empty-state" style={{ padding: 20 }}>No products found.</div>
                ) : (
                  visibleProducts.map((p) => (
                    <label key={p._id} className="mail-pick-row">
                      <input
                        type="checkbox"
                        checked={selectedProducts.includes(p._id)}
                        onChange={() => toggleProduct(p._id)}
                      />
                      <span className="mail-pick-body">
                        <strong>{p.name}</strong>
                        {p.hsCode ? <span className="mail-pick-meta">HS {p.hsCode}</span> : null}
                      </span>
                      {linkedProductIds.has(p._id) ? <span className="badge badge-success">Linked</span> : null}
                    </label>
                  ))
                )}
              </div>
            </div>

            {fieldKeys.length > 0 && (
              <div className="panel">
                <div className="panel-title">4. Message details</div>
                <div className="form-grid">
                  {fieldKeys.map((key) => {
                    const def = defs[key] || { label: key, type: 'text' as const }
                    const value = userFields[key] ?? autoDefaults[key] ?? ''
                    const wide = def.type === 'textarea' || key === 'subjectLine'
                    return (
                      <div className={`field ${wide ? 'span-2' : ''}`} key={key}>
                        <label htmlFor={`mf-${key}`}>{def.label}</label>
                        {def.type === 'textarea' ? (
                          <textarea
                            id={`mf-${key}`}
                            style={{ minHeight: 140 }}
                            value={value}
                            placeholder={def.placeholder}
                            onChange={(e) => setUserFields((f) => ({ ...f, [key]: e.target.value }))}
                          />
                        ) : (
                          <input
                            id={`mf-${key}`}
                            type={def.type === 'number' ? 'number' : 'text'}
                            step={def.type === 'number' ? 'any' : undefined}
                            value={value}
                            placeholder={def.placeholder}
                            onChange={(e) => setUserFields((f) => ({ ...f, [key]: e.target.value }))}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="panel mail-preview-panel" style={{ position: 'sticky', top: 'calc(var(--topbar-h, 60px) + 12px)' }}>
            <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Preview</span>
              {previewLoading && <span className="badge">Rendering…</span>}
            </div>
            {!template || selectedRows.length === 0 ? (
              <div className="empty-state">Select a template and at least one recipient to preview the email.</div>
            ) : previewError ? (
              <div className="login-error">{previewError}</div>
            ) : preview ? (
              <>
                <div style={{ marginBottom: 10, fontSize: 13 }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>To: </span>
                    {selectedRows[0].toEmail}
                    {selectedRows.length > 1 && (
                      <span style={{ color: 'var(--text-muted)' }}> (+{selectedRows.length - 1} more, previewing first)</span>
                    )}
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Subject: </span>
                    <strong>{preview.subject}</strong>
                  </div>
                </div>
                <iframe
                  title="Email preview"
                  sandbox=""
                  srcDoc={`<!doctype html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#222;padding:16px;margin:0">${preview.html}</body></html>`}
                  style={{
                    width: '100%',
                    height: 420,
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    background: '#fff',
                  }}
                />
              </>
            ) : (
              <div className="loading-block">Generating preview…</div>
            )}
            <div className="form-actions" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="btn"
                disabled={!canEmail || sending || !template || selectedRows.length === 0}
                onClick={() => void onSend()}
                title={canEmail ? undefined : 'You do not have permission to send email'}
              >
                {sending ? 'Sending…' : `Send email${selectedRows.length ? ` (${selectedRows.length})` : ''}`}
              </button>
            </div>
            {!canEmail && (
              <p style={{ marginTop: 12, fontSize: 12.5, color: 'var(--text-muted)' }}>
                You can preview emails but your account is not permitted to send them.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
