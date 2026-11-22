import type { ReactNode } from 'react'

export function Field({
  label,
  htmlFor,
  required,
  hint,
  className,
  children,
}: {
  label: string
  htmlFor?: string
  required?: boolean
  hint?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`field ${className || ''}`.trim()}>
      <label htmlFor={htmlFor}>
        {label}
        {required ? ' *' : ''}
      </label>
      {children}
      {hint ? <small style={{ color: 'var(--text-muted)', fontSize: 12 }}>{hint}</small> : null}
    </div>
  )
}
