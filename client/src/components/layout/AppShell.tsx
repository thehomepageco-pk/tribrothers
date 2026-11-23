import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  Package,
  FileText,
  Shield,
  Search,
  Mail,
  Bell,
  Menu,
  X,
  Building2,
  Boxes,
  Ship,
  Receipt,
  Wallet,
  BarChart3,
  Activity,
  Settings,
  LogOut,
  ClipboardList,
  ListTodo,
  UserRound,
  KeyRound,
  Camera,
  Unlock,
  ShieldAlert,
  PanelLeftOpen,
  PanelLeftClose,
} from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { api, apiForm } from '@/api/client'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { normalizeHref } from '@/lib/links'
import { initials } from '@/lib/avatar'
import { uploadUrl } from '@/lib/entity'
import { formatDate } from '@/lib/utils'
import { AccessUnlockPanel } from '@/components/AccessUnlockPanel'
import { TimedAccessBanner } from '@/components/TimedAccessBanner'
import { Modal } from '@/components/ui/Modal'

type TopItem = {
  to: string
  label: string
  perm?: 'dashboard' | 'products' | 'clients' | 'quotes' | 'adminPanel' | 'mail'
  adminOnly?: boolean
}

type RailItem = {
  to: string
  tip: string
  icon: typeof LayoutDashboard
  perm?: TopItem['perm'] | 'suppliers' | 'sessions'
  adminOnly?: boolean
  end?: boolean
}

const TOP_NAV: TopItem[] = [
  { to: '/', label: 'Dashboard', perm: 'dashboard' },
  { to: '/clients', label: 'Clients', perm: 'clients' },
  { to: '/products', label: 'Products', perm: 'products' },
  { to: '/quotes', label: 'Quotes', perm: 'quotes' },
  { to: '/indents', label: 'Indents', perm: 'quotes' },
  { to: '/tasks', label: 'Tasks', perm: 'dashboard' },
  { to: '/admin', label: 'Admin', perm: 'adminPanel' },
]

const RAIL: RailItem[] = [
  { to: '/', tip: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard', end: true },
  { to: '/clients', tip: 'Clients', icon: Users, perm: 'clients' },
  { to: '/products', tip: 'Products', icon: Package, perm: 'products' },
  { to: '/suppliers', tip: 'Suppliers', icon: Building2, perm: 'suppliers' },
  { to: '/tasks', tip: 'Tasks', icon: ListTodo, perm: 'dashboard' },
  { to: '/quotes', tip: 'Quotations & Offers', icon: FileText, perm: 'quotes' },
  { to: '/sales-contracts', tip: 'Sales Contracts', icon: ClipboardList, perm: 'quotes' },
  { to: '/indents', tip: 'Indents', icon: Boxes, perm: 'quotes' },
  { to: '/shipments', tip: 'Shipments', icon: Ship, perm: 'quotes' },
  { to: '/invoices', tip: 'Invoices', icon: Receipt, perm: 'quotes' },
  { to: '/commissions', tip: 'Commissions', icon: Wallet, perm: 'quotes' },
  { to: '/mail', tip: 'Mail', icon: Mail, perm: 'mail' },
  { to: '/reports', tip: 'Reports', icon: BarChart3, perm: 'quotes' },
  { to: '/sessions', tip: 'Sessions', icon: Activity, perm: 'sessions' },
  { to: '/admin', tip: 'Admin', icon: Shield, perm: 'adminPanel' },
  { to: '/settings', tip: 'Settings', icon: Settings, adminOnly: true },
]

type SearchHit = { type: string; label: string; href: string; meta?: string }
type SearchDoc = Record<string, unknown>
type SearchResponse =
  | SearchHit[]
  | { results?: SearchHit[] }
  | Record<string, SearchDoc[] | undefined>

type NotifItem = {
  _id: string
  title?: string
  message?: string
  href?: string
  read?: boolean
  createdAt?: string
  type?: string
  accessRequestId?: string
  meta?: { status?: string; permission?: string; durationMinutes?: number }
}

function toHits(data: SearchResponse): SearchHit[] {
  if (Array.isArray(data)) return data
  if ('results' in data && Array.isArray(data.results)) return data.results as SearchHit[]
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const join = (...v: unknown[]) => v.map(str).filter(Boolean).join(' · ')
  const groups = [
    { key: 'products', type: 'Product', href: '/products', label: (d: SearchDoc) => str(d.name), meta: (d: SearchDoc) => join(d.category, d.hsCode) },
    { key: 'clients', type: 'Client', href: '/clients', label: (d: SearchDoc) => str(d.companyName), meta: (d: SearchDoc) => join(d.city, d.country) },
    { key: 'suppliers', type: 'Supplier', href: '/suppliers', label: (d: SearchDoc) => str(d.companyName), meta: (d: SearchDoc) => join(d.city, d.country) },
    { key: 'contracts', type: 'Contract', href: '/sales-contracts', label: (d: SearchDoc) => str(d.contractNumber), meta: () => '' },
    { key: 'indents', type: 'Indent', href: '/indents', label: (d: SearchDoc) => str(d.indentNumber), meta: () => '' },
    { key: 'shipments', type: 'Shipment', href: '/shipments', label: (d: SearchDoc) => str(d.shipmentNumber), meta: (d: SearchDoc) => str(d.blNumber) },
    { key: 'invoices', type: 'Invoice', href: '/invoices', label: (d: SearchDoc) => str(d.invoiceNumber), meta: () => '' },
  ]
  const record = data as Record<string, SearchDoc[] | undefined>
  const out: SearchHit[] = []
  for (const g of groups) {
    for (const d of record[g.key] || []) {
      const label = g.label(d) || g.type
      const id = d._id != null ? String(d._id) : ''
      const q = encodeURIComponent(label)
      out.push({
        type: g.type,
        label,
        href: id ? `${g.href}?q=${q}&highlight=${encodeURIComponent(id)}` : `${g.href}?q=${q}`,
        meta: g.meta(d),
      })
    }
  }
  return out
}

export function AppShell() {
  const { user, logout, can, canEmail, canEdit, isAdmin, isOwner, refresh } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [railOpen, setRailOpen] = useState(false)
  const [railExpanded, setRailExpanded] = useState(() => {
    try {
      return localStorage.getItem('tri.railExpanded') === '1'
    } catch {
      return false
    }
  })
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 961px)').matches : true,
  )
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [profileModal, setProfileModal] = useState<'edit' | 'password' | null>(null)
  const [accessModal, setAccessModal] = useState<{ open: boolean; permission: string }>({
    open: false,
    permission: 'canEdit',
  })
  const timedActive = Boolean(
    !isAdmin && (user?.adminOverride?.active || user?.tempAccess?.active),
  )
  const [scrolled, setScrolled] = useState(false)
  const [displayNameEdit, setDisplayNameEdit] = useState('')
  const [emailEdit, setEmailEdit] = useState('')
  const [designationEdit, setDesignationEdit] = useState('')
  const [mobileEdit, setMobileEdit] = useState('')
  const [whatsappEdit, setWhatsappEdit] = useState('')
  const [wechatEdit, setWechatEdit] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const canEditCard = isAdmin || isOwner
  const debounced = useDebouncedValue(query, 250)
  const navigate = useNavigate()
  const location = useLocation()
  const searchRef = useRef<HTMLDivElement>(null)
  const profileRef = useRef<HTMLDivElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const notifQ = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ items: NotifItem[]; unreadCount: number }>('/api/notifications?limit=20'),
    refetchInterval: 60_000,
  })

  useEffect(() => {
    document.body.classList.remove('login-page', 'app-layout', 'sidebar-open')
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('tri.railExpanded', railExpanded ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [railExpanded])

  useEffect(() => {
    function onNeedUnlock(e: Event) {
      if (isAdmin) return
      const detail = (e as CustomEvent<{ permission?: string }>).detail
      setAccessModal({
        open: true,
        permission: detail?.permission || 'canEdit',
      })
    }
    window.addEventListener('tri:need-unlock', onNeedUnlock)
    return () => window.removeEventListener('tri:need-unlock', onNeedUnlock)
  }, [isAdmin])

  useEffect(() => {
    setRailOpen(false)
    setSearchOpen(false)
    setProfileOpen(false)
    setNotifOpen(false)
  }, [location.pathname])

  useEffect(() => {
    document.body.classList.toggle('soft-drawer-open', railOpen)
    return () => document.body.classList.remove('soft-drawer-open')
  }, [railOpen])

  useEffect(() => {
    if (!railOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setRailOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [railOpen])

  useEffect(() => {
    function onScroll() {
      const mobile = window.matchMedia('(max-width: 960px)').matches
      setScrolled(mobile && window.scrollY > 12)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 961px)')
    const apply = () => setIsDesktop(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  const topItems = useMemo(
    () =>
      TOP_NAV.filter((item) => {
        if (item.adminOnly) return isAdmin
        if (item.perm === 'mail') return isAdmin || canEmail
        if (!item.perm) return true
        return can(item.perm)
      }),
    [can, canEmail, isAdmin],
  )

  const railItems = useMemo(
    () =>
      RAIL.filter((item) => {
        if (item.adminOnly) return isAdmin
        if (item.perm === 'mail') return isAdmin || canEmail
        if (!item.perm) return true
        return can(item.perm as 'dashboard')
      }),
    [can, canEmail, isAdmin],
  )

  useEffect(() => {
    if (!searchOpen || !debounced.trim()) {
      setHits([])
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    api<SearchResponse>(`/api/search?q=${encodeURIComponent(debounced.trim())}`)
      .then((data) => {
        if (!cancelled) setHits(toHits(data))
      })
      .catch(() => {
        if (!cancelled) setHits([])
      })
      .finally(() => {
        if (!cancelled) setSearching(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced, searchOpen])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (!searchRef.current?.contains(t)) setSearchOpen(false)
      if (!profileRef.current?.contains(t)) setProfileOpen(false)
      if (!notifRef.current?.contains(t)) setNotifOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const displayName = user?.displayName || user?.username || 'User'
  const avatarLetters = initials(displayName)
  const avatarSrc = user?.avatarUrl ? uploadUrl(user.avatarUrl) : ''
  const unread = notifQ.data?.unreadCount || 0
  const notifs = notifQ.data?.items || []

  async function markAllRead() {
    try {
      await api('/api/notifications/read', { method: 'POST', body: JSON.stringify({ all: true }) })
      qc.invalidateQueries({ queryKey: ['notifications'] })
    } catch {
      toast('Could not mark notifications read', 'error')
    }
  }

  async function markOneRead(id: string) {
    try {
      await api(`/api/notifications/${id}/read`, { method: 'POST' })
      qc.invalidateQueries({ queryKey: ['notifications'] })
    } catch {
      /* ignore */
    }
  }

  async function saveProfile() {
    setSavingProfile(true)
    try {
      const payload: Record<string, string> = {
        displayName: displayNameEdit,
        email: emailEdit,
      }
      if (canEditCard) {
        payload.designation = designationEdit
        payload.mobile = mobileEdit
        payload.whatsapp = whatsappEdit
        payload.wechat = wechatEdit
      }
      await api('/api/me', { method: 'PUT', body: JSON.stringify(payload) })
      await refresh()
      toast('Profile updated', 'success')
      setProfileModal(null)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update profile', 'error')
    } finally {
      setSavingProfile(false)
    }
  }

  async function savePassword() {
    setSavingProfile(true)
    try {
      await api('/api/me/password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      toast('Password updated', 'success')
      setCurrentPassword('')
      setNewPassword('')
      setProfileModal(null)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update password', 'error')
    } finally {
      setSavingProfile(false)
    }
  }

  async function onAvatarFile(file: File | null) {
    if (!file) return
    const fd = new FormData()
    fd.append('avatar', file)
    try {
      await apiForm('/api/me/avatar', fd)
      await refresh()
      toast('Photo updated', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not upload photo', 'error')
    }
  }

  async function reviewAccess(id: string, approve: boolean) {
    try {
      await api(`/api/access-requests/${id}/${approve ? 'approve' : 'deny'}`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
      toast(approve ? 'Access approved' : 'Access denied', 'success')
      qc.invalidateQueries({ queryKey: ['notifications'] })
      setNotifOpen(false)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update request', 'error')
    }
  }

  return (
    <div
      className={`soft-shell${railOpen ? ' is-drawer-open' : ''}${railExpanded ? ' is-rail-expanded' : ''}${scrolled ? ' is-scrolled' : ''}`}
    >
      <header className={`soft-topbar${scrolled ? ' is-scrolled' : ''}`}>
        <button
          type="button"
          className="soft-menu-toggle"
          aria-label={railOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={railOpen}
          onClick={() => setRailOpen((v) => !v)}
        >
          {railOpen ? <X size={18} /> : <Menu size={18} />}
        </button>

        <Link to="/" className="soft-brand" onClick={() => setRailOpen(false)}>
          <img className="soft-brand-mark" src="/img/tri-logo.png" alt="" />
          <span className="soft-brand-text">Tri Brothers</span>
        </Link>

        <nav className="soft-top-nav" aria-label="Primary">
          {topItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `soft-top-link${isActive ? ' active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="soft-top-utils">
          <div ref={searchRef} className="soft-search-wrap">
            <button
              type="button"
              className="soft-icon-btn"
              aria-label="Search"
              aria-expanded={searchOpen}
              onClick={() => {
                setSearchOpen((v) => !v)
                setNotifOpen(false)
                setProfileOpen(false)
              }}
            >
              <Search size={17} />
            </button>
            {searchOpen && (
              <div className="soft-search-pop">
                <input
                  autoFocus
                  type="search"
                  inputMode="search"
                  placeholder="Search products, clients, contracts…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query.trim() ? (
                  searching ? (
                    <div className="soft-search-hit">Searching…</div>
                  ) : hits.length === 0 ? (
                    <div className="soft-search-hit">No matches</div>
                  ) : (
                    hits.map((hit, i) => (
                      <Link
                        key={`${hit.href}-${i}`}
                        className="soft-search-hit"
                        to={normalizeHref(hit.href)}
                        onClick={() => {
                          setSearchOpen(false)
                          setQuery('')
                        }}
                      >
                        <div>{hit.label}</div>
                        <div className="soft-search-meta">
                          {hit.type}
                          {hit.meta ? ` · ${hit.meta}` : ''}
                        </div>
                      </Link>
                    ))
                  )
                ) : (
                  <div className="soft-search-hit">Type at least 2 characters</div>
                )}
              </div>
            )}
          </div>

          {(isAdmin || canEmail) && (
            <Link to="/mail" className="soft-icon-btn soft-util-secondary" aria-label="Mail">
              <Mail size={17} />
            </Link>
          )}

          {!isAdmin ? (
            <button
              type="button"
              className={`soft-icon-btn soft-access-btn${timedActive ? ' is-active' : ''}`}
              aria-label={timedActive ? 'Manage timed access' : 'Request or unlock access'}
              title={timedActive ? 'Manage timed access' : 'Request or unlock access'}
              onClick={() => {
                setAccessModal({ open: true, permission: 'canEdit' })
                setNotifOpen(false)
                setProfileOpen(false)
                setSearchOpen(false)
              }}
            >
              {timedActive ? <Unlock size={17} /> : <ShieldAlert size={17} />}
            </button>
          ) : null}

          <div ref={notifRef} className="soft-pop-wrap">
            <button
              type="button"
              className="soft-icon-btn"
              aria-label="Notifications"
              aria-expanded={notifOpen}
              onClick={() => {
                setNotifOpen((v) => !v)
                setProfileOpen(false)
                setSearchOpen(false)
              }}
            >
              <Bell size={17} />
              {unread > 0 ? <span className="soft-badge-dot">{unread > 9 ? '9+' : unread}</span> : null}
            </button>
            {notifOpen ? (
              <div className="soft-dropdown soft-notif-dropdown">
                <div className="soft-dropdown-head">
                  <strong>Notifications</strong>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void markAllRead()} disabled={!unread}>
                    Mark all read
                  </button>
                </div>
                <div className="soft-dropdown-body">
                  {notifQ.isLoading ? (
                    <div className="soft-dropdown-empty">Loading…</div>
                  ) : notifs.length === 0 ? (
                    <div className="soft-dropdown-empty">You&apos;re all caught up.</div>
                  ) : (
                    notifs.map((n) => {
                      const pendingAccess =
                        isAdmin &&
                        n.type === 'access_request' &&
                        n.accessRequestId &&
                        n.meta?.status !== 'approved' &&
                        n.meta?.status !== 'denied'
                      return (
                        <div key={n._id} className={`soft-notif-row${n.read ? '' : ' is-unread'}`}>
                          <button
                            type="button"
                            className="soft-notif-main"
                            onClick={() => {
                              void markOneRead(n._id)
                              if (!pendingAccess) {
                                setNotifOpen(false)
                                const granted = n.title === 'Access granted' || n.meta?.status === 'approved'
                                if (granted) {
                                  void refresh().then(() => {
                                    window.location.assign(n.href?.startsWith('/') ? n.href : '/')
                                  })
                                  return
                                }
                                navigate(n.href?.startsWith('/') ? n.href : '/')
                              }
                            }}
                          >
                            <strong>{n.title || 'Update'}</strong>
                            <span>{n.message}</span>
                            <time>{n.createdAt ? formatDate(n.createdAt) : ''}</time>
                          </button>
                          {pendingAccess ? (
                            <div className="soft-notif-actions">
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => void reviewAccess(String(n.accessRequestId), true)}
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => void reviewAccess(String(n.accessRequestId), false)}
                              >
                                Deny
                              </button>
                            </div>
                          ) : null}
                        </div>
                      )
                    })
                  )}
                </div>
                <div className="soft-dropdown-foot">
                  <Link to="/" onClick={() => setNotifOpen(false)}>
                    Open dashboard
                  </Link>
                </div>
              </div>
            ) : null}
          </div>

          <div ref={profileRef} className="soft-pop-wrap">
            <button
              type="button"
              className="soft-avatar soft-avatar-btn"
              title={displayName}
              aria-label="Profile menu"
              aria-expanded={profileOpen}
              onClick={() => {
                setProfileOpen((v) => !v)
                setNotifOpen(false)
                setSearchOpen(false)
              }}
            >
              {avatarSrc ? <img src={avatarSrc} alt="" /> : avatarLetters}
            </button>
            {profileOpen ? (
              <div className="soft-dropdown soft-profile-dropdown">
                <div className="soft-profile-meta">
                  <div className="soft-avatar soft-avatar-lg">
                    {avatarSrc ? <img src={avatarSrc} alt="" /> : avatarLetters}
                  </div>
                  <div>
                    <strong>{displayName}</strong>
                    <span>{user?.email || user?.username}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="soft-menu-item"
                  onClick={() => {
                    setDisplayNameEdit(user?.displayName || '')
                    setEmailEdit(user?.email || '')
                    setDesignationEdit(user?.designation || '')
                    setMobileEdit(user?.mobile || '')
                    setWhatsappEdit(user?.whatsapp || '')
                    setWechatEdit(user?.wechat || '')
                    setProfileModal('edit')
                    setProfileOpen(false)
                  }}
                >
                  <UserRound size={15} /> Edit profile
                </button>
                <button
                  type="button"
                  className="soft-menu-item"
                  onClick={() => {
                    setCurrentPassword('')
                    setNewPassword('')
                    setProfileModal('password')
                    setProfileOpen(false)
                  }}
                >
                  <KeyRound size={15} /> Change password
                </button>
                <button
                  type="button"
                  className="soft-menu-item"
                  onClick={() => {
                    setProfileOpen(false)
                    avatarInputRef.current?.click()
                  }}
                >
                  <Camera size={15} /> Change photo
                </button>
                {!isAdmin ? (
                  <button
                    type="button"
                    className="soft-menu-item"
                    onClick={() => {
                      setProfileOpen(false)
                      setAccessModal({ open: true, permission: 'canEdit' })
                    }}
                  >
                    {timedActive || canEdit ? <Unlock size={15} /> : <ShieldAlert size={15} />}
                    {timedActive ? 'Extend / manage access' : 'Request or unlock access'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="soft-menu-item is-danger"
                  onClick={async () => {
                    await logout()
                    navigate('/login')
                  }}
                >
                  <LogOut size={15} /> Sign out
                </button>
              </div>
            ) : null}
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                void onAvatarFile(e.target.files?.[0] || null)
                e.target.value = ''
              }}
            />
          </div>
        </div>
      </header>

      <div
        className={`soft-drawer-backdrop${railOpen ? ' is-open' : ''}`}
        onClick={() => setRailOpen(false)}
        aria-hidden={!railOpen}
      />

      <aside className={`soft-rail${railOpen ? ' open' : ''}`} aria-label="Quick navigation">
        <div className="soft-rail-head">
          <span>Menu</span>
          <button type="button" className="soft-rail-close" aria-label="Close menu" onClick={() => setRailOpen(false)}>
            <X size={18} />
          </button>
        </div>
        {isDesktop ? (
          <button
            type="button"
            className="soft-rail-expand soft-rail-link"
            aria-label={railExpanded ? 'Collapse menu' : 'Expand menu'}
            aria-expanded={railExpanded}
            title={railExpanded ? 'Collapse menu' : 'Expand menu'}
            onClick={() => setRailExpanded((v) => !v)}
          >
            {railExpanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
            <span className="soft-rail-label">{railExpanded ? 'Collapse' : 'Expand'}</span>
          </button>
        ) : null}
        {railItems.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              data-tip={item.tip}
              className={({ isActive }) => `soft-rail-link${isActive ? ' active' : ''}`}
              aria-label={item.tip}
              onClick={() => setRailOpen(false)}
            >
              <Icon size={18} />
              <span className="soft-rail-label">{item.tip}</span>
            </NavLink>
          )
        })}
        <div className="soft-rail-spacer" />
        {!isAdmin ? (
          <button
            type="button"
            className="soft-rail-link"
            data-tip={timedActive ? 'Manage access' : 'Request access'}
            aria-label={timedActive ? 'Manage timed access' : 'Request or unlock access'}
            onClick={() => {
              setRailOpen(false)
              setAccessModal({ open: true, permission: 'canEdit' })
            }}
          >
            {timedActive ? <Unlock size={18} /> : <ShieldAlert size={18} />}
            <span className="soft-rail-label">{timedActive ? 'Manage access' : 'Request access'}</span>
          </button>
        ) : null}
        <button
          type="button"
          className="soft-rail-link"
          data-tip="Sign out"
          aria-label="Sign out"
          onClick={async () => {
            await logout()
            navigate('/login')
          }}
        >
          <LogOut size={18} />
          <span className="soft-rail-label">Sign out</span>
        </button>
      </aside>

      <main className="soft-main">
        <TimedAccessBanner />
        {!isAdmin && !timedActive ? (
          <div className="staff-access-nudge">
            <div className="staff-access-nudge-copy">
              <strong>Need restricted access?</strong>
              <span>Ask an admin to approve a timed request, or unlock this device with their password.</span>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setAccessModal({ open: true, permission: 'canEdit' })}
            >
              Request or unlock access
            </button>
          </div>
        ) : null}
        <Outlet />
      </main>

      {profileModal === 'edit' ? (
        <div className="modal-backdrop" onClick={() => setProfileModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Edit profile</h2>
              <button type="button" className="modal-close-btn" onClick={() => setProfileModal(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="pf-name">Display name</label>
                  <input id="pf-name" value={displayNameEdit} onChange={(e) => setDisplayNameEdit(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="pf-email">Email</label>
                  <input id="pf-email" type="email" value={emailEdit} onChange={(e) => setEmailEdit(e.target.value)} />
                </div>
                {canEditCard ? (
                  <>
                    <div className="field">
                      <label htmlFor="pf-des">Designation</label>
                      <input id="pf-des" value={designationEdit} onChange={(e) => setDesignationEdit(e.target.value)} />
                    </div>
                    <div className="field">
                      <label htmlFor="pf-mob">Mobile</label>
                      <input id="pf-mob" value={mobileEdit} onChange={(e) => setMobileEdit(e.target.value)} />
                    </div>
                    <div className="field">
                      <label htmlFor="pf-wa">WhatsApp</label>
                      <input id="pf-wa" value={whatsappEdit} onChange={(e) => setWhatsappEdit(e.target.value)} />
                    </div>
                    <div className="field">
                      <label htmlFor="pf-wc">WeChat</label>
                      <input id="pf-wc" value={wechatEdit} onChange={(e) => setWechatEdit(e.target.value)} />
                    </div>
                  </>
                ) : null}
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setProfileModal(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-sm" disabled={savingProfile} onClick={() => void saveProfile()}>
                {savingProfile ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {profileModal === 'password' ? (
        <div className="modal-backdrop" onClick={() => setProfileModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Change password</h2>
              <button type="button" className="modal-close-btn" onClick={() => setProfileModal(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label htmlFor="pf-cur">Current password</label>
                <input
                  id="pf-cur"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="pf-new">New password</label>
                <input
                  id="pf-new"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setProfileModal(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-sm" disabled={savingProfile} onClick={() => void savePassword()}>
                {savingProfile ? 'Saving…' : 'Update'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {accessModal.open ? (
        <Modal
          title="Request or unlock access"
          large
          onClose={() => setAccessModal((s) => ({ ...s, open: false }))}
        >
          <AccessUnlockPanel
            permission={accessModal.permission}
            onUnlocked={() => setAccessModal((s) => ({ ...s, open: false }))}
          />
        </Modal>
      ) : null}
    </div>
  )
}
