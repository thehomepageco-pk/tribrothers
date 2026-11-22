import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { AccessRequiredPage } from '@/pages/AccessRequiredPage'
import type { Permissions } from '@/types'

export function ProtectedRoute({
  children,
  permission,
  adminOnly,
}: {
  children: React.ReactNode
  permission?: keyof Permissions | 'mail'
  adminOnly?: boolean
}) {
  const { user, loading, can, canEmail, isAdmin } = useAuth()
  const location = useLocation()

  if (loading) {
    return <div className="loading-block">Loading…</div>
  }

  if (!user?.authenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (adminOnly && !isAdmin && !can('adminPanel')) {
    return (
      <AccessRequiredPage
        permission="adminPanel"
        title="Admin access required"
      />
    )
  }

  if (permission === 'mail') {
    if (!(isAdmin || canEmail)) {
      return <AccessRequiredPage permission="canEmail" title="Email access required" />
    }
  } else if (permission && !can(permission)) {
    return (
      <AccessRequiredPage
        permission={permission}
        title="Access required"
      />
    )
  }

  return <>{children}</>
}
