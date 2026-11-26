import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '@/api/client'
import { pageKeyFromPath, permissionForPageKey } from '@/lib/accessScope'
import type { AuthUser, Permissions } from '@/types'

type UnlockScope = {
  pageKey: string
  permission: string
  actions: { canEdit?: boolean; canDelete?: boolean; canEmail?: boolean; view?: boolean }
}

type AuthContextValue = {
  user: AuthUser | null
  loading: boolean
  refresh: () => Promise<AuthUser | null>
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  can: (key: keyof Permissions | 'mail') => boolean
  canEdit: boolean
  canDelete: boolean
  canEmail: boolean
  isAdmin: boolean
  isOwner: boolean
  unlock: (username: string, password: string, minutes?: number, scope?: UnlockScope) => Promise<void>
  clearUnlock: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const AUTH_CHECK_TIMEOUT_MS = 4000

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('auth-check-timeout')), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const raw = await withTimeout(
        api<
          AuthUser & {
            user?: {
              id?: string
              userId?: string
              username?: string
              displayName?: string
              role?: string
              permissions?: Permissions
            } | null
          }
        >('/api/auth/check'),
        AUTH_CHECK_TIMEOUT_MS,
      )
      const nested = raw.user || null
      const nestedAny = nested as
        | (NonNullable<typeof nested> & { email?: string; avatarUrl?: string; id?: string })
        | null
      const rawAny = raw as AuthUser & { tempAccess?: AuthUser['tempAccess'] }
      const data: AuthUser = {
        authenticated: Boolean(raw.authenticated),
        adminOverride: raw.adminOverride,
        tempAccess: rawAny.tempAccess,
        userId: nestedAny?.id ?? nestedAny?.userId ?? raw.userId,
        username: nestedAny?.username ?? raw.username,
        displayName: nestedAny?.displayName ?? raw.displayName,
        email: nestedAny?.email ?? rawAny.email,
        avatarUrl: nestedAny?.avatarUrl ?? rawAny.avatarUrl,
        designation: (nestedAny as AuthUser | null)?.designation ?? rawAny.designation,
        mobile: (nestedAny as AuthUser | null)?.mobile ?? rawAny.mobile,
        whatsapp: (nestedAny as AuthUser | null)?.whatsapp ?? rawAny.whatsapp,
        wechat: (nestedAny as AuthUser | null)?.wechat ?? rawAny.wechat,
        role: nestedAny?.role ?? raw.role,
        permissions: nestedAny?.permissions ?? raw.permissions,
      }
      setUser(data)
      return data
    } catch {
      setUser({ authenticated: false })
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Keep timed access in sync; when the window ends, drop privileges client-side promptly.
  useEffect(() => {
    if (!user?.authenticated || user.role === 'admin') return
    const overrideMs = user.adminOverride?.active ? Number(user.adminOverride.expiresAt) : 0
    const tempMs = user.tempAccess?.active ? Number(user.tempAccess.expiresAt) : 0
    const end = Math.min(
      ...[overrideMs, tempMs].filter((n) => Number.isFinite(n) && n > Date.now()),
      Number.POSITIVE_INFINITY,
    )
    if (!Number.isFinite(end) || end === Number.POSITIVE_INFINITY) {
      // Still refresh occasionally so approved access requests appear without a full reload.
      const id = window.setInterval(() => {
        void refresh()
      }, 45_000)
      return () => window.clearInterval(id)
    }
    const wait = Math.max(500, end - Date.now() + 250)
    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          await api('/api/auth/admin-override/clear', { method: 'POST' })
        } catch {
          /* still refresh */
        }
        await refresh()
        window.location.reload()
      })()
    }, wait)
    const poll = window.setInterval(() => {
      void refresh()
    }, 20_000)
    return () => {
      window.clearTimeout(timeout)
      window.clearInterval(poll)
    }
  }, [
    user?.authenticated,
    user?.role,
    user?.adminOverride?.active,
    user?.adminOverride?.expiresAt,
    user?.tempAccess?.active,
    user?.tempAccess?.expiresAt,
    refresh,
  ])

  const login = useCallback(
    async (username: string, password: string) => {
      await api('/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      await refresh()
    },
    [refresh],
  )

  const logout = useCallback(async () => {
    try {
      await api('/logout', { method: 'POST' })
    } finally {
      setUser({ authenticated: false })
    }
  }, [])

  const isAdmin = user?.role === 'admin'
  const isOwner = user?.role === 'owner' || user?.role === 'user'

  const overrideActive = Boolean(user?.adminOverride?.active)
  const tempActive = Boolean(user?.tempAccess?.active)

  const currentPageKey = pageKeyFromPath(location.pathname)
  const currentPerm = currentPageKey ? permissionForPageKey(currentPageKey) : null

  const timedPages = (src?: { pages?: string[]; permission?: string; pageKey?: string } | null) => {
    if (!src) return [] as string[]
    if (Array.isArray(src.pages) && src.pages.length) return src.pages.map(String)
    if (src.permission) return [String(src.permission)]
    return [] as string[]
  }

  const overridePages = timedPages(user?.adminOverride)
  const tempPages = timedPages(user?.tempAccess)

  const timedCoversPage = (pages: string[], permKey: string) => {
    if (!pages.length) return false
    if (pages.includes(permKey)) return true
    if (permKey === 'mail' && (pages.includes('mail') || user?.adminOverride?.canEmail || user?.tempAccess?.canEmail)) {
      return true
    }
    return false
  }

  /** Action unlocks only apply on the scoped page (or its permission group). */
  const timedActionOnCurrentPage = (
    flag: boolean | undefined,
    pages: string[],
  ) => {
    if (!flag) return false
    if (!pages.length) return false
    if (!currentPerm && !currentPageKey) return false
    if (currentPerm && pages.includes(currentPerm)) return true
    if (currentPageKey && pages.includes(currentPageKey)) return true
    // Quotes group pages share permission "quotes"
    if (currentPerm === 'quotes' && pages.includes('quotes')) return true
    return false
  }

  const can = useCallback(
    (key: keyof Permissions | 'mail') => {
      if (!user?.authenticated) return false
      if (isAdmin) return true
      if (user.permissions?.[key as keyof Permissions]) return true
      if (overrideActive && timedCoversPage(overridePages, key)) return true
      if (tempActive && timedCoversPage(tempPages, key)) return true
      return false
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, isAdmin, overrideActive, tempActive, overridePages.join('|'), tempPages.join('|')],
  )

  const canEdit =
    isAdmin ||
    Boolean(user?.permissions?.canEdit) ||
    timedActionOnCurrentPage(user?.adminOverride?.canEdit, overridePages) ||
    timedActionOnCurrentPage(user?.tempAccess?.canEdit, tempPages)

  const canDelete =
    isAdmin ||
    Boolean(user?.permissions?.canDelete) ||
    timedActionOnCurrentPage(user?.adminOverride?.canDelete, overridePages) ||
    timedActionOnCurrentPage(user?.tempAccess?.canDelete, tempPages)

  const canEmail =
    isAdmin ||
    Boolean(user?.permissions?.canEmail) ||
    Boolean(overrideActive && user?.adminOverride?.canEmail) ||
    Boolean(tempActive && user?.tempAccess?.canEmail) ||
    timedActionOnCurrentPage(user?.adminOverride?.canEmail, overridePages) ||
    timedActionOnCurrentPage(user?.tempAccess?.canEmail, tempPages)

  const unlock = useCallback(
    async (username: string, password: string, minutes = 15, scope?: UnlockScope) => {
      if (!scope?.permission && !scope?.pageKey) {
        throw new Error('Select which page and options to unlock')
      }
      await api('/api/auth/admin-override', {
        method: 'POST',
        body: JSON.stringify({
          username,
          password,
          durationMinutes: minutes,
          pageKey: scope.pageKey,
          permission: scope.permission,
          actions: scope.actions,
        }),
      })
      await refresh()
    },
    [refresh],
  )

  const clearUnlock = useCallback(async () => {
    await api('/api/auth/admin-override/clear', { method: 'POST' })
    await refresh()
  }, [refresh])

  const value = useMemo(
    () => ({
      user,
      loading,
      refresh,
      login,
      logout,
      can,
      canEdit,
      canDelete,
      canEmail,
      isAdmin,
      isOwner,
      unlock,
      clearUnlock,
    }),
    [
      user,
      loading,
      refresh,
      login,
      logout,
      can,
      canEdit,
      canDelete,
      canEmail,
      isAdmin,
      isOwner,
      unlock,
      clearUnlock,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
