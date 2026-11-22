import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import {
  ACCESS_ACTIONS,
  ACCESS_PAGES,
  labelForPageKey,
  pageKeyFromPath,
  pathForPageKey,
  permissionForPageKey,
  type AccessActionKey,
} from '@/lib/accessScope'

const REQUEST_DURATIONS = [15, 30, 60, 120]
const UNLOCK_DURATIONS = [5, 10, 15, 20, 30]

function defaultActions(permissionHint?: string): AccessActionKey[] {
  if (permissionHint === 'canEmail' || permissionHint === 'mail') return ['view', 'canEmail']
  if (permissionHint === 'canDelete') return ['view', 'canDelete']
  if (permissionHint === 'canEdit') return ['view', 'canEdit']
  if (permissionHint === 'adminPanel') return ['view']
  return ['view', 'canEdit']
}

function defaultPage(permissionHint?: string, pathname?: string): string {
  if (permissionHint === 'mail' || permissionHint === 'canEmail') return 'mail'
  if (permissionHint === 'adminPanel') return 'admin'
  if (permissionHint && ACCESS_PAGES.some((p) => p.permission === permissionHint || p.key === permissionHint)) {
    const match = ACCESS_PAGES.find((p) => p.key === permissionHint || p.permission === permissionHint)
    if (match) return match.key
  }
  return pageKeyFromPath(pathname || '/') || 'quotes'
}

export function AccessUnlockPanel({
  permission = 'canEdit',
  onUnlocked,
}: {
  permission?: string
  onUnlocked?: () => void
}) {
  const { unlock, refresh, isAdmin } = useAuth()
  const { toast } = useToast()
  const location = useLocation()

  const [pageKey, setPageKey] = useState(() => defaultPage(permission, location.pathname))
  const [actions, setActions] = useState<AccessActionKey[]>(() => defaultActions(permission))
  const [duration, setDuration] = useState(30)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const [unlockOpen, setUnlockOpen] = useState(false)
  const [adminUser, setAdminUser] = useState('')
  const [adminPass, setAdminPass] = useState('')
  const [unlockMins, setUnlockMins] = useState(15)
  const [unlocking, setUnlocking] = useState(false)

  const pageMeta = useMemo(() => ACCESS_PAGES.find((p) => p.key === pageKey), [pageKey])
  const scopeSummary = useMemo(() => {
    const page = labelForPageKey(pageKey)
    const opts = ACCESS_ACTIONS.filter((a) => actions.includes(a.key)).map((a) => a.label)
    return `${page} · ${opts.join(', ') || 'none'}`
  }, [pageKey, actions])

  function toggleAction(key: AccessActionKey) {
    setActions((prev) => {
      if (key === 'view') return prev.includes('view') ? prev : [...prev, 'view']
      if (prev.includes(key)) {
        const next = prev.filter((k) => k !== key)
        return next.includes('view') ? next : ['view', ...next]
      }
      return prev.includes('view') ? [...prev, key] : ['view', key]
    })
  }

  function scopePayload() {
    const perm = permissionForPageKey(pageKey)
    return {
      pageKey,
      permission: perm,
      path: pathForPageKey(pageKey),
      actions: {
        view: true,
        canEdit: actions.includes('canEdit'),
        canDelete: actions.includes('canDelete'),
        canEmail: actions.includes('canEmail') || pageKey === 'mail',
      },
    }
  }

  async function requestAccess() {
    if (!actions.length) {
      toast('Select at least one option', 'error')
      return
    }
    setSending(true)
    try {
      const scope = scopePayload()
      await api('/api/access-requests', {
        method: 'POST',
        body: JSON.stringify({
          permission: scope.permission,
          pageKey: scope.pageKey,
          path: scope.path,
          durationMinutes: duration,
          note,
          actions: scope.actions,
        }),
      })
      setSent(true)
      toast(`Request sent for ${scopeSummary}`, 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not send request', 'error')
    } finally {
      setSending(false)
    }
  }

  async function doUnlock() {
    if (!adminUser.trim() || !adminPass) {
      toast('Enter admin username and password', 'error')
      return
    }
    if (!actions.length) {
      toast('Select at least one option', 'error')
      return
    }
    setUnlocking(true)
    try {
      const scope = scopePayload()
      await unlock(adminUser.trim(), adminPass, unlockMins, {
        pageKey: scope.pageKey,
        permission: scope.permission,
        actions: scope.actions,
      })
      toast(`Unlocked ${scopeSummary} for ${unlockMins} min`, 'success')
      await refresh()
      onUnlocked?.()
      window.setTimeout(() => window.location.assign(scope.path), 200)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Unlock failed', 'error')
    } finally {
      setUnlocking(false)
    }
  }

  if (isAdmin) {
    return <p className="form-hint">You already have admin access.</p>
  }

  return (
    <div className="access-unlock-panel">
      <div className="form-section" style={{ borderTop: 'none', paddingTop: 0 }}>
        <div className="form-section-title">What do you need?</div>
        <p className="form-hint">Pick one page and only the options required — nothing else is unlocked.</p>
        <div className="form-grid">
          <div className="field span-2">
            <label htmlFor="access-page">Page</label>
            <select id="access-page" value={pageKey} onChange={(e) => setPageKey(e.target.value)}>
              {ACCESS_PAGES.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field span-2">
            <span className="field-label">Options</span>
            <div className="access-action-list">
              {ACCESS_ACTIONS.map((a) => (
                <label key={a.key} className="access-action-item">
                  <input
                    type="checkbox"
                    checked={actions.includes(a.key)}
                    disabled={a.key === 'view'}
                    onChange={() => toggleAction(a.key)}
                  />
                  <span>
                    <strong>{a.label}</strong>
                    <small>{a.hint}</small>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <p className="form-hint" style={{ marginTop: 8 }}>
          Scope: <strong>{scopeSummary}</strong>
          {pageMeta ? ` → ${pageMeta.path}` : ''}
        </p>
      </div>

      <div className="form-section">
        <div className="form-section-title">1. Ask an admin</div>
        <p className="form-hint">Admins see the page and options you selected before they approve.</p>
        {sent ? (
          <p className="form-hint">Request sent for {scopeSummary}. You&apos;ll be notified when an admin responds.</p>
        ) : (
          <>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="ar-mins">Duration</label>
                <select id="ar-mins" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                  {REQUEST_DURATIONS.map((m) => (
                    <option key={m} value={m}>
                      {m} minutes
                    </option>
                  ))}
                </select>
              </div>
              <div className="field span-2">
                <label htmlFor="ar-note">Note (optional)</label>
                <input
                  id="ar-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Why you need this…"
                />
              </div>
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-sm" disabled={sending} onClick={() => void requestAccess()}>
                {sending ? 'Sending…' : 'Send request to admin'}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="form-section">
        <div className="form-section-title">2. Admin unlock on this machine</div>
        <p className="form-hint">
          Admin enters their password. Only the selected page and options unlock, then the timer ends and access is
          removed.
        </p>
        {!unlockOpen ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setUnlockOpen(true)}>
            Unlock with admin password
          </button>
        ) : (
          <div className="form-grid">
            <div className="field">
              <label htmlFor="ul-user">Admin username</label>
              <input
                id="ul-user"
                name="admin-unlock-user"
                value={adminUser}
                onChange={(e) => setAdminUser(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="ul-pass">Admin password</label>
              <input
                id="ul-pass"
                name="admin-unlock-pass"
                type="password"
                value={adminPass}
                onChange={(e) => setAdminPass(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="field">
              <label htmlFor="ul-mins">Minutes</label>
              <select id="ul-mins" value={unlockMins} onChange={(e) => setUnlockMins(Number(e.target.value))}>
                {UNLOCK_DURATIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-actions span-2">
              <button type="button" className="btn btn-sm" disabled={unlocking} onClick={() => void doUnlock()}>
                {unlocking ? 'Unlocking…' : 'Unlock selected scope'}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setUnlockOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
