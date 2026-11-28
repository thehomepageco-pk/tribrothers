import { useEffect, useRef, useState } from 'react'
import { api, apiForm } from '@/api/client'
import { useToast } from '@/context/ToastContext'
import { Modal } from '@/components/ui/Modal'

type ImportType = 'products' | 'clients' | 'suppliers'

type FormatInfo = {
  type: string
  headers: string[]
  sample: Record<string, string>
  help: string[]
  aiSupported?: boolean
}

type ImportResult = {
  message?: string
  created?: Array<{ line?: number; id?: string; name?: string }>
  updated?: Array<{ line?: number; id?: string; name?: string; contactsAdded?: number; contact?: string }>
  skipped?: Array<{ line?: number; reason?: string }>
  errors?: Array<{ line?: number; reason?: string }>
  extracted?: number
  preview?: Array<{ companyName?: string }>
}

export function EntityImportPanel({
  type,
  onDone,
}: {
  type: ImportType
  onDone?: () => void
}) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<FormatInfo | null>(null)
  const [busy, setBusy] = useState<'csv' | 'ai' | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const csvRef = useRef<HTMLInputElement>(null)
  const pdfRef = useRef<HTMLInputElement>(null)

  const label = type === 'products' ? 'products' : type === 'clients' ? 'clients' : 'suppliers'
  const aiEnabled = type !== 'products'

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const data = await api<FormatInfo>(`/api/import/format/${type}`)
        if (!cancelled) setFormat(data)
      } catch (e) {
        if (!cancelled) toast(e instanceof Error ? e.message : 'Could not load import format', 'error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, type, toast])

  async function onCsv(file: File | null) {
    if (!file) return
    setBusy('csv')
    setResult(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await apiForm<ImportResult>(`/api/import/csv/${type}`, body)
      setResult(res)
      toast(res.message || `Imported ${res.created?.length || 0} ${label}`, 'success')
      onDone?.()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'CSV import failed', 'error')
    } finally {
      setBusy(null)
      if (csvRef.current) csvRef.current.value = ''
    }
  }

  async function onPdf(file: File | null) {
    if (!file) return
    setBusy('ai')
    setResult(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await apiForm<ImportResult>(`/api/import/ai/${type}`, body)
      setResult(res)
      toast(res.message || `AI imported ${res.created?.length || 0} ${label}`, 'success')
      onDone?.()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'AI import failed', 'error')
    } finally {
      setBusy(null)
      if (pdfRef.current) pdfRef.current.value = ''
    }
  }

  return (
    <>
      <button type="button" className="btn btn-import" onClick={() => setOpen(true)}>
        Import
      </button>
      {open ? (
        <Modal title={`Import ${label}`} large onClose={() => setOpen(false)}>
          <div className="entity-import-panel">
            <section className="entity-import-section">
              <h3>1. CSV import</h3>
              <p className="form-hint">
                Download the template, keep the header row, then upload your file. One{' '}
                {type === 'products' ? 'product' : 'company'} per row. Existing names are skipped.
              </p>
              {format ? (
                <>
                  <ul className="entity-import-help">
                    {format.help.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                  <div className="entity-import-columns">
                    <strong>Required columns</strong>
                    <code>{format.headers.join(', ')}</code>
                  </div>
                  <div className="entity-import-actions">
                    <a className="btn btn-secondary" href={`/api/import/template/${type}`} download>
                      Download CSV template
                    </a>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy !== null}
                      onClick={() => csvRef.current?.click()}
                    >
                      {busy === 'csv' ? 'Importing…' : 'Upload CSV file'}
                    </button>
                    <input
                      ref={csvRef}
                      type="file"
                      accept=".csv,text/csv"
                      hidden
                      onChange={(e) => void onCsv(e.target.files?.[0] || null)}
                    />
                  </div>
                </>
              ) : (
                <p className="form-hint">Loading format…</p>
              )}
            </section>

            {aiEnabled ? (
              <section className="entity-import-section">
                <h3>2. AI from PDF</h3>
                <p className="form-hint">
                  Upload a PDF (company list, brochure, or contact sheet). AI extracts companies and contacts, then adds
                  new {label}. Requires <code>OPENAI_API_KEY</code> on the server.
                </p>
                <div className="entity-import-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy !== null}
                    onClick={() => pdfRef.current?.click()}
                  >
                    {busy === 'ai' ? 'Reading PDF…' : 'Upload PDF for AI'}
                  </button>
                  <input
                    ref={pdfRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    hidden
                    onChange={(e) => void onPdf(e.target.files?.[0] || null)}
                  />
                </div>
              </section>
            ) : null}

            {result ? (
              <section className="entity-import-section">
                <h3>Result</h3>
                <p className="form-hint">
                  Created <strong>{result.created?.length || 0}</strong>
                  {result.updated?.length
                    ? ` · Contacts added on ${result.updated.length} existing`
                    : ''}
                  {result.extracted != null ? ` · AI found ${result.extracted}` : ''}
                  {result.skipped?.length ? ` · Skipped ${result.skipped.length}` : ''}
                  {result.errors?.length ? ` · Errors ${result.errors.length}` : ''}
                </p>
                {result.updated?.length ? (
                  <details className="entity-import-details">
                    <summary>Contacts merged ({result.updated.length})</summary>
                    <ul>
                      {result.updated.slice(0, 40).map((s, i) => (
                        <li key={`${s.line}-${i}`}>
                          Line {s.line}: {s.name}
                          {s.contact ? ` ← ${s.contact}` : ''}
                          {s.contactsAdded ? ` (+${s.contactsAdded})` : ''}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {result.skipped?.length ? (
                  <details className="entity-import-details">
                    <summary>Skipped ({result.skipped.length})</summary>
                    <ul>
                      {result.skipped.slice(0, 40).map((s, i) => (
                        <li key={`${s.line}-${i}`}>
                          Line {s.line}: {s.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {result.errors?.length ? (
                  <details className="entity-import-details">
                    <summary>Errors ({result.errors.length})</summary>
                    <ul>
                      {result.errors.slice(0, 40).map((s, i) => (
                        <li key={`${s.line}-${i}`}>
                          Line {s.line}: {s.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </section>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  )
}
