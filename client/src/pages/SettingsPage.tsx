import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { PageHeader } from '@/components/PageHeader'
import { useToast } from '@/context/ToastContext'
import { downloadExport } from '@/lib/utils'
import type { EmailTemplate, Settings } from '@/types'

const TEXT_KEYS = [
  'companyName',
  'companyAddress',
  'companyPhone',
  'companyEmail',
  'defaultCurrency',
  'mailService',
  'mailHost',
  'mailUser',
  'mailPass',
  'mailFrom',
  'emailSignature',
] as const

const NUM_KEYS = [
  'usdToPkrRate',
  'defaultMargin',
  'defaultImportDuty',
  'defaultIncomeTax',
  'defaultSalesTax',
  'mailPort',
] as const

type FormValues = Record<(typeof TEXT_KEYS)[number] | (typeof NUM_KEYS)[number], string>

const EXPORTS: Array<{ type: string; label: string }> = [
  { type: 'clients', label: 'Export clients' },
  { type: 'suppliers', label: 'Export suppliers' },
  { type: 'products', label: 'Export products' },
  { type: 'quotations', label: 'Export quotations' },
  { type: 'contracts', label: 'Export contracts' },
  { type: 'indents', label: 'Export indents' },
  { type: 'shipments', label: 'Export shipments' },
  { type: 'invoices', label: 'Export invoices' },
]

function emptyValues(): FormValues {
  const v = {} as FormValues
  for (const k of [...TEXT_KEYS, ...NUM_KEYS]) v[k] = ''
  v.defaultCurrency = 'USD'
  return v
}

function TemplateEditor({ tpl }: { tpl: EmailTemplate }) {
  const { toast } = useToast()
  const [subject, setSubject] = useState(tpl.subject || '')
  const [bodyHtml, setBodyHtml] = useState(tpl.bodyHtml || '')

  const save = useMutation({
    mutationFn: () =>
      api(`/api/email-templates/${tpl._id}`, {
        method: 'PUT',
        body: JSON.stringify({ subject, bodyHtml }),
      }),
    onSuccess: () => toast('Template saved', 'success'),
    onError: (e: Error) => toast(e.message || 'Failed to save template', 'error'),
  })

  return (
    <div className="panel">
      <h3 className="panel-title" style={{ marginBottom: 4 }}>{tpl.name || tpl.slug || 'Template'}</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 12.5, marginBottom: 12 }}>
        {tpl.description || ''}
        {tpl.description ? ' — ' : ''}Fields: {(tpl.requiredFields || []).join(', ') || 'none'}
      </p>
      <div className="form-grid">
        <div className="field span-2">
          <label>Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="field span-2">
          <label>Body HTML</label>
          <textarea
            rows={8}
            style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5 }}
            value={bodyHtml}
            onChange={(e) => setBodyHtml(e.target.value)}
          />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <button type="button" className="btn" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save template'}
        </button>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  useEffect(() => { document.title = 'Settings'; }, [])

  const { toast } = useToast()
  const qc = useQueryClient()
  const [values, setValues] = useState<FormValues>(emptyValues)
  const [exporting, setExporting] = useState<string | null>(null)

  const settingsQ = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<Settings>('/api/settings'),
  })

  const templatesQ = useQuery({
    queryKey: ['email-templates-all'],
    queryFn: () => api<EmailTemplate[]>('/api/email-templates/all'),
  })

  useEffect(() => {
    const s = settingsQ.data
    if (!s) return
    const next = emptyValues()
    for (const k of [...TEXT_KEYS, ...NUM_KEYS]) {
      const v = (s as Record<string, unknown>)[k]
      if (v != null) next[k] = String(v)
    }
    setValues(next)
  }, [settingsQ.data])

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, string | number> = {}
      for (const k of TEXT_KEYS) payload[k] = values[k]
      for (const k of NUM_KEYS) {
        if (values[k] !== '' && !Number.isNaN(Number(values[k]))) payload[k] = Number(values[k])
      }
      return api('/api/settings', { method: 'PUT', body: JSON.stringify(payload) })
    },
    onSuccess: () => {
      toast('Settings saved', 'success')
      void qc.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: (e: Error) => toast(e.message || 'Failed to save settings', 'error'),
  })

  const set = (k: keyof FormValues) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }))

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    save.mutate()
  }

  async function runExport(type: string) {
    setExporting(type)
    try {
      await downloadExport(type)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed', 'error')
    } finally {
      setExporting(null)
    }
  }

  const templates = Array.isArray(templatesQ.data) ? templatesQ.data : []

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Settings"
        lede="Company profile, defaults, and email configuration. Admin only."
      />

      {settingsQ.error ? (
        <div className="panel" role="alert" style={{ color: 'var(--error)' }}>
          {settingsQ.error instanceof Error ? settingsQ.error.message : 'Failed to load settings'}
        </div>
      ) : null}

      <form onSubmit={onSubmit}>
        <div className="panel">
          <h2 className="panel-title">Company profile</h2>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="s-companyName">Company name</label>
              <input id="s-companyName" value={values.companyName} onChange={set('companyName')} />
            </div>
            <div className="field">
              <label htmlFor="s-companyPhone">Phone</label>
              <input id="s-companyPhone" value={values.companyPhone} onChange={set('companyPhone')} />
            </div>
            <div className="field">
              <label htmlFor="s-companyEmail">Email</label>
              <input id="s-companyEmail" type="email" value={values.companyEmail} onChange={set('companyEmail')} />
            </div>
            <div className="field">
              <label htmlFor="s-defaultCurrency">Default currency</label>
              <input id="s-defaultCurrency" value={values.defaultCurrency} onChange={set('defaultCurrency')} />
            </div>
            <div className="field">
              <label htmlFor="s-usdToPkrRate">USD to PKR rate (for reports)</label>
              <input
                id="s-usdToPkrRate"
                type="number"
                min={0}
                step="0.01"
                placeholder="278"
                value={values.usdToPkrRate}
                onChange={set('usdToPkrRate')}
              />
            </div>
            <div className="field span-2">
              <label htmlFor="s-companyAddress">Address</label>
              <textarea id="s-companyAddress" value={values.companyAddress} onChange={set('companyAddress')} />
            </div>
          </div>
        </div>

        <div className="panel">
          <h2 className="panel-title">Defaults</h2>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="s-defaultMargin">Default margin (%)</label>
              <input id="s-defaultMargin" type="number" step="0.1" value={values.defaultMargin} onChange={set('defaultMargin')} />
            </div>
            <div className="field">
              <label htmlFor="s-defaultImportDuty">Default import duty (%)</label>
              <input id="s-defaultImportDuty" type="number" step="0.01" value={values.defaultImportDuty} onChange={set('defaultImportDuty')} />
            </div>
            <div className="field">
              <label htmlFor="s-defaultIncomeTax">Default income tax (%)</label>
              <input id="s-defaultIncomeTax" type="number" step="0.01" value={values.defaultIncomeTax} onChange={set('defaultIncomeTax')} />
            </div>
            <div className="field">
              <label htmlFor="s-defaultSalesTax">Default sales tax (%)</label>
              <input id="s-defaultSalesTax" type="number" step="0.01" value={values.defaultSalesTax} onChange={set('defaultSalesTax')} />
            </div>
          </div>
        </div>

        <div className="panel">
          <h2 className="panel-title">Email (SMTP)</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 14 }}>
            For Gmail: leave host blank (or use <code>smtp.gmail.com</code>), port <strong>587</strong>, and a Google{' '}
            <strong>App Password</strong>. The app connects over IPv4 to avoid common network errors.
          </p>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="s-mailService">Mail service</label>
              <input id="s-mailService" placeholder="gmail" value={values.mailService} onChange={set('mailService')} />
            </div>
            <div className="field">
              <label htmlFor="s-mailHost">SMTP host (optional)</label>
              <input id="s-mailHost" placeholder="smtp.gmail.com" value={values.mailHost} onChange={set('mailHost')} />
            </div>
            <div className="field">
              <label htmlFor="s-mailPort">SMTP port</label>
              <input id="s-mailPort" type="number" placeholder="587" value={values.mailPort} onChange={set('mailPort')} />
            </div>
            <div className="field">
              <label htmlFor="s-mailUser">Mail user</label>
              <input id="s-mailUser" autoComplete="off" value={values.mailUser} onChange={set('mailUser')} />
            </div>
            <div className="field">
              <label htmlFor="s-mailPass">Mail password</label>
              <input
                id="s-mailPass"
                type="password"
                autoComplete="new-password"
                placeholder="Gmail App Password"
                value={values.mailPass}
                onChange={set('mailPass')}
              />
            </div>
            <div className="field">
              <label htmlFor="s-mailFrom">From address</label>
              <input id="s-mailFrom" type="email" value={values.mailFrom} onChange={set('mailFrom')} />
            </div>
            <div className="field span-2">
              <label htmlFor="s-emailSignature">Email signature</label>
              <textarea id="s-emailSignature" value={values.emailSignature} onChange={set('emailSignature')} />
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <button type="submit" className="btn" disabled={save.isPending || settingsQ.isLoading}>
            {save.isPending ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>

      <div className="panel">
        <h2 className="panel-title">Data export</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 12 }}>
          Download CSV exports of your data.
        </p>
        <div className="dash-actions" style={{ marginBottom: 0 }}>
          {EXPORTS.map((x) => (
            <button
              key={x.type}
              type="button"
              className="action-btn"
              disabled={exporting === x.type}
              onClick={() => void runExport(x.type)}
            >
              {exporting === x.type ? 'Exporting…' : x.label}
            </button>
          ))}
        </div>
      </div>

      <h2 className="panel-title" style={{ marginTop: 28 }}>Email templates</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 14 }}>
        Edit mail templates used on the Mail page. Use placeholders like <code>{'{{productName}}'}</code>,{' '}
        <code>{'{{price}}'}</code>, <code>{'{{recipientName}}'}</code>, <code>{'{{signature}}'}</code>,{' '}
        <code>{'{{customMessageBlock}}'}</code>. <strong>Custom email</strong> is freeform subject + body.
      </p>
      {templatesQ.isLoading ? (
        <p className="loading-block">Loading templates…</p>
      ) : templatesQ.error ? (
        <div className="panel" role="alert" style={{ color: 'var(--error)' }}>
          {templatesQ.error instanceof Error ? templatesQ.error.message : 'Failed to load templates'}
        </div>
      ) : templates.length === 0 ? (
        <p className="empty-state">No templates found.</p>
      ) : (
        templates.map((t) => <TemplateEditor key={t._id} tpl={t} />)
      )}
    </>
  )
}
