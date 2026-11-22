import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api } from '@/api/client'
import { RowActionsMenu } from '@/components/RowActionsMenu'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { formatDate, toDateInput } from '@/lib/utils'

type TaskUser = { _id: string; username?: string; displayName?: string }
type Task = {
  _id: string
  title?: string
  description?: string
  status?: string
  priority?: string
  dueDate?: string | null
  assignee?: TaskUser | string | null
}

const blank = {
  title: '',
  description: '',
  status: 'Todo',
  priority: 'Medium',
  dueDate: '',
  assignee: '',
}

export default function TasksPage() {
  const { canEdit, canDelete, isAdmin } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const [formOpen, setFormOpen] = useState(params.get('new') === '1')
  const [editing, setEditing] = useState<Task | null>(null)
  const [form, setForm] = useState(blank)
  const [search, setSearch] = useState('')

  useEffect(() => {
    document.title = 'Tasks | TRI Dashboard'
  }, [])

  useEffect(() => {
    if (params.get('new') === '1') {
      setEditing(null)
      setForm(blank)
      setFormOpen(true)
    }
  }, [params])

  const tasksQ = useQuery({ queryKey: ['tasks'], queryFn: () => api<Task[]>('/api/tasks') })
  const usersQ = useQuery({
    queryKey: ['assignable-users'],
    queryFn: () => api<TaskUser[]>('/api/users/assignable'),
  })

  const saveMut = useMutation({
    mutationFn: async () => {
      const body = {
        title: form.title.trim(),
        description: form.description.trim(),
        status: form.status,
        priority: form.priority,
        dueDate: form.dueDate || null,
        assignee: isAdmin ? form.assignee || null : undefined,
      }
      if (editing) {
        return api(`/api/tasks/${editing._id}`, { method: 'PUT', body: JSON.stringify(body) })
      }
      return api('/api/tasks', { method: 'POST', body: JSON.stringify(body) })
    },
    onSuccess: () => {
      toast(editing ? 'Task updated' : 'Task created', 'success')
      setFormOpen(false)
      setEditing(null)
      setForm(blank)
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (e: Error) => toast(e.message || 'Save failed', 'error'),
  })

  const delMut = useMutation({
    mutationFn: (id: string) => api(`/api/tasks/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Task deleted', 'success')
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (e: Error) => toast(e.message || 'Delete failed', 'error'),
  })

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api(`/api/tasks/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      }),
    onSuccess: (_d, vars) => {
      toast(vars.status === 'Done' ? 'Task marked completed' : 'Task reopened', 'success')
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: (e: Error) => toast(e.message || 'Could not update status', 'error'),
  })

  const tasks = tasksQ.data || []
  const users = usersQ.data || []

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tasks
    return tasks.filter((t) => {
      const who =
        t.assignee && typeof t.assignee === 'object'
          ? `${t.assignee.displayName || ''} ${t.assignee.username || ''}`
          : ''
      return `${t.title || ''} ${who} ${t.status || ''}`.toLowerCase().includes(q)
    })
  }, [tasks, search])

  function openEdit(t: Task) {
    setEditing(t)
    setForm({
      title: t.title || '',
      description: t.description || '',
      status: t.status || 'Todo',
      priority: t.priority || 'Medium',
      dueDate: t.dueDate ? toDateInput(t.dueDate) : '',
      assignee: t.assignee ? (typeof t.assignee === 'string' ? t.assignee : t.assignee._id) : '',
    })
    setFormOpen(true)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) {
      toast('Title is required', 'error')
      return
    }
    saveMut.mutate()
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Tasks</h1>
          <p className="page-lede">Create a task, then assign it from the dashboard board.</p>
        </div>
        {canEdit ? (
          <div className="page-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (formOpen && !editing) setFormOpen(false)
                else {
                  setEditing(null)
                  setForm(blank)
                  setFormOpen(true)
                }
              }}
            >
              {formOpen && !editing ? 'Close form' : '+ New task'}
            </button>
          </div>
        ) : null}
      </header>

      <div className={`form-container${formOpen ? ' show' : ''}`}>
        <h2 style={{ marginBottom: 12 }}>{editing ? 'Edit task' : 'New task'}</h2>
        <form onSubmit={onSubmit}>
          <label htmlFor="taskTitle">Title *</label>
          <input
            id="taskTitle"
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. Follow up client on indent"
          />

          <div className="form-grid" style={{ marginTop: 12 }}>
            <div>
              <label htmlFor="taskAssignee">Assign to</label>
              <select
                id="taskAssignee"
                value={form.assignee}
                disabled={!isAdmin}
                onChange={(e) => setForm({ ...form, assignee: e.target.value })}
              >
                <option value="">Unassigned (optional)</option>
                {users.map((u) => (
                  <option key={u._id} value={u._id}>
                    {u.displayName || u.username}
                  </option>
                ))}
              </select>
              {!isAdmin ? <p className="form-hint">Only admins can assign tasks.</p> : null}
            </div>
            <div>
              <label htmlFor="taskPriority">Priority</label>
              <select
                id="taskPriority"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                <option>Low</option>
                <option>Medium</option>
                <option>High</option>
                <option>Urgent</option>
              </select>
            </div>
            <div>
              <label htmlFor="taskStatus">Status</label>
              <select
                id="taskStatus"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option>Todo</option>
                <option>In progress</option>
                <option>Done</option>
                <option>Cancelled</option>
              </select>
            </div>
            <div>
              <label htmlFor="taskDue">Due date</label>
              <input
                id="taskDue"
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </div>
          </div>

          <label htmlFor="taskDesc" style={{ marginTop: 12 }}>
            Description
          </label>
          <textarea
            id="taskDesc"
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Notes for the assignee"
          />

          <div className="form-actions">
            <button type="submit" className="btn" disabled={saveMut.isPending}>
              {saveMut.isPending ? 'Saving…' : 'Save task'}
            </button>
            {editing ? (
              <button
                type="button"
                className="action-btn"
                onClick={() => {
                  setEditing(null)
                  setForm(blank)
                  setFormOpen(false)
                }}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </div>

      <div className="products-toolbar">
        <div className="toolbar-row">
          <div className="toolbar-group">
            <label htmlFor="taskSearch">Search</label>
            <input
              id="taskSearch"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Title, assignee…"
            />
          </div>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Assignee</th>
              <th>Due</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tasksQ.isLoading ? (
              <tr>
                <td colSpan={6}>Loading…</td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6}>No tasks yet.</td>
              </tr>
            ) : (
              filtered.map((t) => (
                <tr key={t._id}>
                  <td className="mobile-card-primary">{t.title}</td>
                  <td data-label="Status">{t.status}</td>
                  <td data-label="Priority">{t.priority}</td>
                  <td data-label="Assignee">
                    {t.assignee && typeof t.assignee === 'object'
                      ? t.assignee.displayName || t.assignee.username
                      : '—'}
                  </td>
                  <td data-label="Due">{t.dueDate ? formatDate(t.dueDate) : '—'}</td>
                  <td className="table-actions-cell" data-label="Actions">
                    <RowActionsMenu
                      items={[
                        {
                          label: 'Mark completed',
                          onClick: () => statusMut.mutate({ id: t._id, status: 'Done' }),
                          hidden: t.status === 'Done' || t.status === 'Cancelled',
                        },
                        {
                          label: 'Mark incomplete',
                          onClick: () => statusMut.mutate({ id: t._id, status: 'Todo' }),
                          hidden: t.status !== 'Done',
                        },
                        {
                          label: 'Edit',
                          onClick: () => openEdit(t),
                          hidden: !canEdit,
                        },
                        {
                          label: 'Delete',
                          onClick: () => {
                            if (window.confirm('Delete this task?')) delMut.mutate(t._id)
                          },
                          danger: true,
                          hidden: !canDelete,
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
