import type { ContactPerson } from '@/types'

const EMPTY: ContactPerson = {
  name: '',
  email: '',
  department: '',
  tel: '',
  mobile: '',
  wechat: '',
  facebook: '',
  whatsapp: '',
  otherSocial: '',
}

export function emptyContact(): ContactPerson {
  return { ...EMPTY }
}

type FieldDef = { key: keyof ContactPerson; label: string; type?: string; placeholder?: string; wide?: boolean }

const PRIMARY: FieldDef[] = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'department', label: 'Department' },
  { key: 'tel', label: 'Telephone', type: 'tel' },
  { key: 'mobile', label: 'Mobile', type: 'tel' },
]

const SOCIAL: FieldDef[] = [
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'wechat', label: 'WeChat' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'otherSocial', label: 'Other', wide: true },
]

export function ContactsEditor({
  value,
  onChange,
  disabled,
  showSocials = true,
}: {
  value: ContactPerson[]
  onChange: (next: ContactPerson[]) => void
  disabled?: boolean
  showSocials?: boolean
}) {
  const rows = value.length ? value : [emptyContact()]
  const fields = showSocials ? [...PRIMARY, ...SOCIAL] : PRIMARY

  function update(idx: number, key: keyof ContactPerson, v: string) {
    onChange(rows.map((row, i) => (i === idx ? { ...row, [key]: v } : row)))
  }

  function remove(idx: number) {
    const next = rows.filter((_, i) => i !== idx)
    onChange(next.length ? next : [emptyContact()])
  }

  return (
    <div className="contacts-editor">
      {rows.map((row, idx) => (
        <div className="contact-block" key={idx}>
          <div className="contact-block-head">
            <span className="contact-block-title">Contact {idx + 1}</span>
            {!disabled && rows.length > 1 ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => remove(idx)}
                aria-label={`Remove contact ${idx + 1}`}
              >
                Remove
              </button>
            ) : null}
          </div>
          <div className="form-grid contact-fields">
            {fields.map((f) => (
              <div className={`field${f.wide ? ' span-2' : ''}`} key={f.key}>
                <label htmlFor={`contact-${idx}-${f.key}`}>{f.label}</label>
                <input
                  id={`contact-${idx}-${f.key}`}
                  type={f.type || 'text'}
                  value={(row[f.key] as string) || ''}
                  placeholder={f.placeholder}
                  disabled={disabled}
                  onChange={(e) => update(idx, f.key, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
      {!disabled ? (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onChange([...rows, emptyContact()])}
        >
          + Add contact
        </button>
      ) : null}
    </div>
  )
}
