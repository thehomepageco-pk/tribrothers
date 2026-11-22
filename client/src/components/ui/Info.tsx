import type { ReactNode } from 'react'

export function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="kpi-title">{label}</div>
      <div style={{ marginTop: 4, wordBreak: 'break-word' }}>{children}</div>
    </div>
  )
}
