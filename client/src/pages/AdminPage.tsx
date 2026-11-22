import { useState, type FormEvent , useEffect} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { PageHeader } from '@/components/PageHeader'
import { RowActionsMenu } from '@/components/RowActionsMenu'
import { Modal } from '@/components/ui/Modal'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import type { AppUser, Permissions } from '@/types'

type UserRow = AppUser & { lastLoginAt?: string | null }
type PermKey = keyof Permissions

const ROLE_DEFAULTS: Record<string, Required<Permissions>> = {
  admin: { dashboard: true, products: true, suppliers: true, clients: true, quotes: true, sessions: true, adminPanel: true, canEdit: true, canDelete: true, canEmail: true },
  owner: { dashboard: true, products: true, suppliers: true, clients: true, quotes: true, sessions: true, adminPanel: false, canEdit: true, canDelete: true, canEmail: true },
  staff: { dashboard: true, products: true, suppliers: true, clients: true, quotes: true, sessions: false, adminPanel: false, canEdit: true, canDelete: false, canEmail: true },
}

const PAGE_PERMS: Array<{ key: PermKey; label: string }> = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'products', label: 'Products' },
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'clients', label: 'Clients' },
  { key: 'quotes', label: 'Quotations & Offers' },
  { key: 'sessions', label: 'Activity / Sessions' },
  { key: 'adminPanel', label: 'Admin Panel' },
]

const ACTION_PERMS: Array<{ key: PermKey; label: string }> = [
  { key: 'canEdit', label: 'Can edit records' },
  { key: 'canDelete', label: 'Can delete records' },
  { key: 'canEmail', label: 'Can send emails' },
]

type FormState = {
  id: string
  username: string
  displayName: string
  email: string
  role: string
  password: string
  isActive: boolean
  permissions: Permissions
}

function blankForm(): FormState {
  return {
    id: '',
    username: '',
    displayName: '',
    email: '',
    role: 'staff',
    password: '',
    isActive: true,
    permissions: { ...ROLE_DEFAULTS.staff },
  }
}

export default function AdminPage() {
  useEffect(() => { document.title = 'Admin Panel'; }, [])

  const { user: me } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()

  const [form, setForm] = useState<FormState | null>(null)
  const [pwTarget, setPwTarget] = useState<UserRow | null>(null)
  const [newPassword, setNewPassword] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: () => api<UserRow[]>('/api/users'),
  })
  const users = Array.isArray(data) ? data : []

  const save = useMutation({
    mutationFn: async (f: FormState) => {
      const payload: Record<string, unknown> = {
        username: f.username.trim(),
        displayName: f.displayName.trim(),
        email: f.email.trim(),
        role: f.role,
        isActive: f.isActive,
        permissions: f.permissions,
      }
      if (f.password) payload.password = f.password
      return api(f.id ? `/api/users/${f.id}` : '/api/users', {
        method: f.id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      })
    },
    onSuccess: (_d, f) => {
      toast(f.id ? 'User updated' : 'User created', 'success')
      setForm(null)
      void qc.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (e: Error) => toast(e.message || 'Failed to save user', 'error'),
  })

  const resetPw = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify({ password }) }),
    onSuccess: () => {
      toast('Password updated', 'success')
      setPwTarget(null)
      setNewPassword('')
    },
    onError: (e: Error) => toast(e.message || 'Failed to update password', 'error'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('User deleted', 'success')
      void qc.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (e: Error) => toast(e.message || 'Failed to delete user', 'error'),
  })

  function openEdit(u: UserRow) {
    setForm({
      id: u._id,
      username: u.username,
      displayName: u.displayName || '',
      email: u.email || '',
      role: u.role || 'staff',
      password: '',
      isActive: u.isActive !== false,
      permissions: { ...(ROLE_DEFAULTS[u.role || 'staff'] || ROLE_DEFAULTS.staff), ...(u.permissions || {}) },
    })
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    if (!form.username.trim()) {
      toast('Username is required', 'error')
      return
    }
    if (!form.id && !form.password) {
      toast('Password is required for new users', 'error')
      return
    }
    save.mutate(form)
  }

  function setPerm(key: PermKey, value: boolean) {
    setForm((f) => (f ? { ...f, permissions: { ...f.permissions, [key]: value } } : f))
  }

  const stats = [
    { label: 'Total users', value: users.length },
    { label: 'Active', value: users.filter((u) => u.isActive !== false).length },
    { label: 'Admins', value: users.filter((u) => u.role === 'admin').length },
    { label: 'Staff', value: users.filter((u) => u.role === 'staff').length },
  ]

  const editing = Boolean(form?.id)

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Admin Panel"
        lede="Manage staff and owner accounts, roles, and page access levels."
        actions={
          <button type="button" className="btn" onClick={() => setForm(blankForm())}>
            Add new user
          </button>
        }
      />

      <section className="kpi-row">
        {stats.map((s) => (
          <div className="kpi-card" key={s.label}>
            <div className="kpi-title">{s.label}</div>
            <div className="kpi-number">{isLoading ? '—' : s.value}</div>
          </div>
        ))}
      </section>

      {error ? (
        <div className="panel" role="alert" style={{ color: 'var(--error)' }}>
          {error instanceof Error ? error.message : 'Failed to load users'}
        </div>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Display name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last login</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="empty-state">Loading…</td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-state">No users yet.</td>
              </tr>
            ) : (
              users.map((u) => {
                const isSelf = Boolean(me?.userId) && String(u._id) === String(me?.userId)
                const active = u.isActive !== false
                return (
                  <tr key={u._id}>
                    <td>
                      {u.username}
                      {isSelf ? <small style={{ color: 'var(--text-muted)' }}> (you)</small> : null}
                    </td>
                    <td>{u.displayName || '—'}</td>
                    <td>{u.email || '—'}</td>
                    <td>
                      <span className={`badge ${u.role === 'admin' ? 'badge-accent' : ''}`}>{u.role || 'staff'}</span>
                    </td>
                    <td>
                      <span className={`badge ${active ? 'badge-success' : 'badge-error'}`}>
                        {active ? 'Active' : 'Deactivated'}
                      </span>
                    </td>
                    <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}</td>
                    <td className="table-actions-cell">
                      <RowActionsMenu
                        items={[
                          { label: 'Edit', onClick: () => openEdit(u) },
                          {
                            label: 'Reset password',
                            onClick: () => {
                              setNewPassword('')
                              setPwTarget(u)
                            },
                          },
                          {
                            label: 'Delete',
                            danger: true,
                            hidden: isSelf || remove.isPending,
                            onClick: () => {
                              if (window.confirm(`Delete user "${u.username}"? This cannot be undone.`)) {
                                remove.mutate(u._id)
                              }
                            },
                          },
                        ]}
                      />
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {form && (
        <Modal
          large
          title={editing ? `Edit user: ${form.username}` : 'Create user account'}
          onClose={() => setForm(null)}
          footer={
            <>
              <button type="button" className="action-btn" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button type="submit" form="user-form" className="btn" disabled={save.isPending}>
                {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create user'}
              </button>
            </>
          }
        >
          <form id="user-form" className="entity-form" onSubmit={onSubmit}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="u-username">Username (login)</label>
                <input
                  id="u-username"
                  required
                  autoComplete="off"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="u-display">Display name</label>
                <input
                  id="u-display"
                  placeholder="Full name"
                  value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="u-email">Email</label>
                <input
                  id="u-email"
                  type="email"
                  placeholder="optional@company.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="u-role">Role</label>
                <select
                  id="u-role"
                  value={form.role}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      role: e.target.value,
                      permissions: { ...(ROLE_DEFAULTS[e.target.value] || ROLE_DEFAULTS.staff) },
                    })
                  }
                >
                  <option value="staff">Staff</option>
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="u-password">
                  {editing ? 'New password (leave blank to keep current)' : 'Password'}
                </label>
                <input
                  id="u-password"
                  type="password"
                  autoComplete="new-password"
                  required={!editing}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
                <small style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  {editing
                    ? 'Only fill in if you want to change the password.'
                    : 'Min 8 characters, letters and numbers.'}
                </small>
              </div>
              <div className="field">
                <label htmlFor="u-active">Account status</label>
                <select
                  id="u-active"
                  value={form.isActive ? 'true' : 'false'}
                  onChange={(e) => setForm({ ...form, isActive: e.target.value === 'true' })}
                >
                  <option value="true">Active</option>
                  <option value="false">Deactivated</option>
                </select>
              </div>
            </div>

            <div className="form-section" style={{ marginTop: 16 }}>
              <div className="form-section-title">Page access</div>
              <div className="form-grid" style={{ gap: 8 }}>
                {PAGE_PERMS.map((p) => (
                  <label className="checkbox-row" key={p.key}>
                    <input
                      type="checkbox"
                      checked={Boolean(form.permissions[p.key])}
                      onChange={(e) => setPerm(p.key, e.target.checked)}
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="form-section" style={{ marginTop: 12 }}>
              <div className="form-section-title">Action permissions</div>
              <div className="form-grid" style={{ gap: 8 }}>
                {ACTION_PERMS.map((p) => (
                  <label className="checkbox-row" key={p.key}>
                    <input
                      type="checkbox"
                      checked={Boolean(form.permissions[p.key])}
                      onChange={(e) => setPerm(p.key, e.target.checked)}
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>
          </form>
        </Modal>
      )}

      {pwTarget && (
        <Modal
          title={`Reset password: ${pwTarget.username}`}
          onClose={() => setPwTarget(null)}
          footer={
            <>
              <button type="button" className="action-btn" onClick={() => setPwTarget(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                disabled={!newPassword || resetPw.isPending}
                onClick={() => resetPw.mutate({ id: pwTarget._id, password: newPassword })}
              >
                {resetPw.isPending ? 'Saving…' : 'Update password'}
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="pw-new">New password</label>
            <input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <small style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              Min 8 characters, letters and numbers.
            </small>
          </div>
        </Modal>
      )}
    </>
  )
}
