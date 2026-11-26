import { useMemo, useState } from 'react'

export type DraftSupplierLink = {
  supplierId: string
  notes: string
  supplierPrice: string
  currency: string
  MOQ: string
  leadTime: string
}

export type DraftClientLink = {
  clientId: string
  notes: string
}

export type DraftProductLink = {
  productId: string
  notes: string
  supplierPrice: string
  currency: string
  MOQ: string
  leadTime: string
}

type Named = { _id: string; name?: string; companyName?: string }

function labelOf(item: Named) {
  return item.name || item.companyName || item._id
}

/** Draft product↔supplier and product↔client links while creating a product. */
export function ProductLinkDrafts({
  suppliers,
  clients,
  supplierDrafts,
  clientDrafts,
  onSupplierDrafts,
  onClientDrafts,
  disabled,
}: {
  suppliers: Named[]
  clients: Named[]
  supplierDrafts: DraftSupplierLink[]
  clientDrafts: DraftClientLink[]
  onSupplierDrafts: (next: DraftSupplierLink[]) => void
  onClientDrafts: (next: DraftClientLink[]) => void
  disabled?: boolean
}) {
  const [supplierId, setSupplierId] = useState('')
  const [clientId, setClientId] = useState('')

  const usedSuppliers = useMemo(() => new Set(supplierDrafts.map((d) => d.supplierId)), [supplierDrafts])
  const usedClients = useMemo(() => new Set(clientDrafts.map((d) => d.clientId)), [clientDrafts])

  return (
    <div className="form-section entity-link-drafts">
      <div className="form-section-title">Links (optional)</div>
      <p className="form-hint">Attach suppliers and clients now — saved after the product is created.</p>

      <div className="link-draft-block">
        <strong>Suppliers</strong>
        <div className="link-draft-add">
          <select
            value={supplierId}
            disabled={disabled}
            onChange={(e) => setSupplierId(e.target.value)}
            aria-label="Add supplier link"
          >
            <option value="">Select supplier…</option>
            {suppliers
              .filter((s) => !usedSuppliers.has(s._id))
              .map((s) => (
                <option key={s._id} value={s._id}>
                  {labelOf(s)}
                </option>
              ))}
          </select>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={disabled || !supplierId}
            onClick={() => {
              if (!supplierId) return
              onSupplierDrafts([
                ...supplierDrafts,
                { supplierId, notes: '', supplierPrice: '', currency: 'USD', MOQ: '', leadTime: '' },
              ])
              setSupplierId('')
            }}
          >
            Add supplier
          </button>
        </div>
        {supplierDrafts.length ? (
          <ul className="link-draft-list">
            {supplierDrafts.map((d) => {
              const s = suppliers.find((x) => x._id === d.supplierId)
              return (
                <li key={d.supplierId}>
                  <div className="link-draft-row">
                    <span>{s ? labelOf(s) : d.supplierId}</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={disabled}
                      onClick={() => onSupplierDrafts(supplierDrafts.filter((x) => x.supplierId !== d.supplierId))}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="link-draft-fields">
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Price"
                      value={d.supplierPrice}
                      disabled={disabled}
                      onChange={(e) =>
                        onSupplierDrafts(
                          supplierDrafts.map((x) =>
                            x.supplierId === d.supplierId ? { ...x, supplierPrice: e.target.value } : x,
                          ),
                        )
                      }
                    />
                    <input
                      type="text"
                      placeholder="Currency"
                      value={d.currency}
                      disabled={disabled}
                      onChange={(e) =>
                        onSupplierDrafts(
                          supplierDrafts.map((x) =>
                            x.supplierId === d.supplierId ? { ...x, currency: e.target.value } : x,
                          ),
                        )
                      }
                    />
                    <input
                      type="text"
                      placeholder="MOQ"
                      value={d.MOQ}
                      disabled={disabled}
                      onChange={(e) =>
                        onSupplierDrafts(
                          supplierDrafts.map((x) => (x.supplierId === d.supplierId ? { ...x, MOQ: e.target.value } : x)),
                        )
                      }
                    />
                    <input
                      type="text"
                      placeholder="Notes"
                      value={d.notes}
                      disabled={disabled}
                      onChange={(e) =>
                        onSupplierDrafts(
                          supplierDrafts.map((x) =>
                            x.supplierId === d.supplierId ? { ...x, notes: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="form-hint">No supplier links yet.</p>
        )}
      </div>

      <div className="link-draft-block">
        <strong>Clients</strong>
        <div className="link-draft-add">
          <select
            value={clientId}
            disabled={disabled}
            onChange={(e) => setClientId(e.target.value)}
            aria-label="Add client link"
          >
            <option value="">Select client…</option>
            {clients
              .filter((c) => !usedClients.has(c._id))
              .map((c) => (
                <option key={c._id} value={c._id}>
                  {labelOf(c)}
                </option>
              ))}
          </select>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={disabled || !clientId}
            onClick={() => {
              if (!clientId) return
              onClientDrafts([...clientDrafts, { clientId, notes: '' }])
              setClientId('')
            }}
          >
            Add client
          </button>
        </div>
        {clientDrafts.length ? (
          <ul className="link-draft-list">
            {clientDrafts.map((d) => {
              const c = clients.find((x) => x._id === d.clientId)
              return (
                <li key={d.clientId}>
                  <div className="link-draft-row">
                    <span>{c ? labelOf(c) : d.clientId}</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={disabled}
                      onClick={() => onClientDrafts(clientDrafts.filter((x) => x.clientId !== d.clientId))}
                    >
                      Remove
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="Notes (optional)"
                    value={d.notes}
                    disabled={disabled}
                    onChange={(e) =>
                      onClientDrafts(
                        clientDrafts.map((x) => (x.clientId === d.clientId ? { ...x, notes: e.target.value } : x)),
                      )
                    }
                  />
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="form-hint">No client links yet.</p>
        )}
      </div>
    </div>
  )
}

/** Draft product links while creating a supplier or client. */
export function ProductAttachmentDrafts({
  products,
  drafts,
  onChange,
  showPricing = false,
  disabled,
  title = 'Linked products (optional)',
}: {
  products: Named[]
  drafts: DraftProductLink[]
  onChange: (next: DraftProductLink[]) => void
  showPricing?: boolean
  disabled?: boolean
  title?: string
}) {
  const [productId, setProductId] = useState('')
  const used = useMemo(() => new Set(drafts.map((d) => d.productId)), [drafts])

  return (
    <div className="form-section entity-link-drafts">
      <div className="form-section-title">{title}</div>
      <p className="form-hint">Choose products to link after save.</p>
      <div className="link-draft-add">
        <select
          value={productId}
          disabled={disabled}
          onChange={(e) => setProductId(e.target.value)}
          aria-label="Add product link"
        >
          <option value="">Select product…</option>
          {products
            .filter((p) => !used.has(p._id))
            .map((p) => (
              <option key={p._id} value={p._id}>
                {labelOf(p)}
              </option>
            ))}
        </select>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={disabled || !productId}
          onClick={() => {
            if (!productId) return
            onChange([
              ...drafts,
              { productId, notes: '', supplierPrice: '', currency: 'USD', MOQ: '', leadTime: '' },
            ])
            setProductId('')
          }}
        >
          Add product
        </button>
      </div>
      {drafts.length ? (
        <ul className="link-draft-list">
          {drafts.map((d) => {
            const p = products.find((x) => x._id === d.productId)
            return (
              <li key={d.productId}>
                <div className="link-draft-row">
                  <span>{p ? labelOf(p) : d.productId}</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={disabled}
                    onClick={() => onChange(drafts.filter((x) => x.productId !== d.productId))}
                  >
                    Remove
                  </button>
                </div>
                <div className="link-draft-fields">
                  {showPricing ? (
                    <>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Price"
                        value={d.supplierPrice}
                        disabled={disabled}
                        onChange={(e) =>
                          onChange(
                            drafts.map((x) =>
                              x.productId === d.productId ? { ...x, supplierPrice: e.target.value } : x,
                            ),
                          )
                        }
                      />
                      <input
                        type="text"
                        placeholder="Currency"
                        value={d.currency}
                        disabled={disabled}
                        onChange={(e) =>
                          onChange(
                            drafts.map((x) =>
                              x.productId === d.productId ? { ...x, currency: e.target.value } : x,
                            ),
                          )
                        }
                      />
                      <input
                        type="text"
                        placeholder="MOQ"
                        value={d.MOQ}
                        disabled={disabled}
                        onChange={(e) =>
                          onChange(drafts.map((x) => (x.productId === d.productId ? { ...x, MOQ: e.target.value } : x)))
                        }
                      />
                    </>
                  ) : null}
                  <input
                    type="text"
                    placeholder="Notes (optional)"
                    value={d.notes}
                    disabled={disabled}
                    onChange={(e) =>
                      onChange(drafts.map((x) => (x.productId === d.productId ? { ...x, notes: e.target.value } : x)))
                    }
                  />
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="form-hint">No product links yet.</p>
      )}
    </div>
  )
}
