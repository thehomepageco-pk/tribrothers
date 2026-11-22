import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/context/AuthContext'

function formatLeft(ms: number) {
  if (ms <= 0) return '0:00'
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function TimedAccessBanner() {
  const { user, isAdmin, clearUnlock, refresh } = useAuth()
  const [now, setNow] = useState(Date.now())

  const expiresAt = useMemo(() => {
    if (isAdmin || !user?.authenticated) return null
    const override = user.adminOverride?.active ? Number(user.adminOverride.expiresAt) : 0
    const temp = user.tempAccess?.active ? Number(user.tempAccess.expiresAt) : 0
    const candidates = [override, temp].filter((n) => Number.isFinite(n) && n > 0)
    if (!candidates.length) return null
    return Math.min(...candidates)
  }, [user, isAdmin])

  const source = useMemo(() => {
    if (!expiresAt) return ''
    if (user?.adminOverride?.active && Number(user.adminOverride.expiresAt) === expiresAt) {
      return 'Admin unlock'
    }
    return 'Approved access'
  }, [expiresAt, user])

  useEffect(() => {
    if (!expiresAt) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [expiresAt])

  useEffect(() => {
    if (!expiresAt) return
    if (now < expiresAt) return
    let cancelled = false
    ;(async () => {
      try {
        if (user?.adminOverride?.active) await clearUnlock()
        else await refresh()
      } finally {
        if (!cancelled) {
          window.location.reload()
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [now, expiresAt, clearUnlock, refresh, user?.adminOverride?.active])

  if (!expiresAt) return null
  const left = expiresAt - now
  if (left <= 0) return null

  const scopeBits = [
    user?.adminOverride?.pageKey || user?.tempAccess?.pageKey || user?.adminOverride?.permission || user?.tempAccess?.permission,
    user?.adminOverride?.canEdit || user?.tempAccess?.canEdit ? 'edit' : null,
    user?.adminOverride?.canDelete || user?.tempAccess?.canDelete ? 'delete' : null,
    user?.adminOverride?.canEmail || user?.tempAccess?.canEmail ? 'email' : null,
  ].filter(Boolean)

  return (
    <div className="timed-access-banner" role="status">
      <strong>{source} active</strong>
      <span>
        {scopeBits.length ? `${scopeBits.join(' · ')} · ` : ''}
        Ends in <em>{formatLeft(left)}</em> — then the page refreshes and access is removed.
      </span>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => {
          void (async () => {
            if (user?.adminOverride?.active) await clearUnlock()
            await refresh()
            window.location.reload()
          })()
        }}
      >
        End now
      </button>
    </div>
  )
}
