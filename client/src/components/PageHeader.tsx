import type { ReactNode } from 'react'

export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
  className,
}: {
  eyebrow?: string
  title: string
  lede?: string
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={`page-header${className ? ` ${className}` : ''}`}>
      <div>
        {eyebrow ? <p className="page-eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {lede ? <p className="page-lede">{lede}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  )
}

export default PageHeader
