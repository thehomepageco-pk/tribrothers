import { Link } from 'react-router-dom'
import { AccessUnlockPanel } from '@/components/AccessUnlockPanel'

export function AccessRequiredPage({
  permission,
  title = 'Access required',
}: {
  permission?: string
  title?: string
}) {
  return (
    <div className="access-required">
      <div className="access-required-card">
        <p className="page-eyebrow">Permissions</p>
        <h1>{title}</h1>
        <p className="page-lede">
          Your account doesn&apos;t include this yet. Ask an admin to approve timed access, or unlock this machine with
          an admin password for a short window.
        </p>
        <AccessUnlockPanel permission={permission || 'canEdit'} />
        <p style={{ marginTop: 16 }}>
          <Link to="/">Back to dashboard</Link>
        </p>
      </div>
    </div>
  )
}
