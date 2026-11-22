import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { initials } from '@/lib/avatar'
import { formatDate } from '@/lib/utils'

type Notif = {
  _id: string
  title?: string
  message?: string
  type?: string
  href?: string
  read?: boolean
  createdAt?: string
  accessRequestId?: string
  meta?: { status?: string; expiresAt?: string }
}

type TaskUser = { _id: string; username?: string; displayName?: string; role?: string }
type Task = {
  _id: string
  title?: string
  status?: string
  priority?: string
  dueDate?: string | null
  assignee?: TaskUser | string | null
  completedAt?: string
  updatedAt?: string
}

type Stats = {
  counts?: Record<string, number | undefined>
  shipmentPipeline?: Array<{ status: string; count?: number }>
  attention?: Array<{ title?: string; meta?: string; detail?: string; href?: string }>
}

type CommissionSummary = { openCount?: number; totalRecords?: number; totalCount?: number }

type DragKind = 'task' | 'user' | null

function assigneeId(t: Task) {
  if (!t.assignee) return ''
  return typeof t.assignee === 'string' ? t.assignee : t.assignee._id
}

function assigneeName(t: Task) {
  if (!t.assignee || typeof t.assignee === 'string') return 'Unassigned'
  return t.assignee.displayName || t.assignee.username || 'Unassigned'
}

function notifTag(type?: string) {
  if (type === 'security') return 'Security'
  if (type === 'access_request') return 'Access'
  if (type === 'task') return 'Task'
  return 'Update'
}

function centerOf(el: HTMLElement | null, board: HTMLElement | null) {
  if (!el || !board) return null
  const a = el.getBoundingClientRect()
  const b = board.getBoundingClientRect()
  return {
    x: a.left + a.width / 2 - b.left,
    y: a.top + a.height / 2 - b.top,
  }
}

export default function DashboardPage() {
  const { isAdmin, user, canDelete } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const boardRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Record<string, HTMLElement | null>>({})

  const [dragKind, setDragKind] = useState<DragKind>(null)
  const [dragTaskId, setDragTaskId] = useState<string | null>(null)
  const [dragUserId, setDragUserId] = useState<string | null>(null)
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [pickedTaskId, setPickedTaskId] = useState<string | null>(null)
  const [justAssigned, setJustAssigned] = useState<{ taskId: string; userId: string } | null>(null)
  const [optimisticAssignee, setOptimisticAssignee] = useState<Record<string, string>>({})

  useEffect(() => {
    document.title = 'TRI Dashboard'
  }, [])

  const notifQ = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ items: Notif[]; unreadCount: number }>('/api/notifications?limit=40'),
  })
  const tasksQ = useQuery({
    queryKey: ['tasks'],
    queryFn: () => api<Task[]>('/api/tasks'),
  })
  const usersQ = useQuery({
    queryKey: ['assignable-users'],
    queryFn: () => api<TaskUser[]>('/api/users/assignable'),
  })
  const statsQ = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => api<Stats>('/api/dashboard/stats'),
  })
  const commissionsQ = useQuery({
    queryKey: ['commissions-summary'],
    queryFn: () =>
      api<CommissionSummary>('/api/commissions/summary').catch(
        (): CommissionSummary => ({ openCount: 0, totalRecords: 0 }),
      ),
  })

  const markAll = useMutation({
    mutationFn: () => api('/api/notifications/read', { method: 'POST', body: JSON.stringify({ all: true }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const clearAll = useMutation({
    mutationFn: () => api('/api/notifications', { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      toast('Notifications cleared', 'success')
    },
    onError: (e: Error) => toast(e.message || 'Could not clear notifications', 'error'),
  })

  const reviewAccess = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      api(`/api/access-requests/${id}/${approve ? 'approve' : 'deny'}`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      toast(vars.approve ? 'Access approved' : 'Access denied', 'success')
    },
    onError: (e: Error) => toast(e.message || 'Could not update request', 'error'),
  })

  const assignMut = useMutation({
    mutationFn: ({ taskId, userId }: { taskId: string; userId: string }) =>
      api(`/api/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify({ assignee: userId }),
      }),
    onSuccess: (_data, vars) => {
      setOptimisticAssignee((m) => ({ ...m, [vars.taskId]: vars.userId }))
      setJustAssigned({ taskId: vars.taskId, userId: vars.userId })
      window.setTimeout(() => setJustAssigned(null), 2200)
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['notifications'] })
      toast('Task assigned', 'success')
    },
    onError: (e: Error) => toast(e.message || 'Could not assign', 'error'),
  })

  const completeMut = useMutation({
    mutationFn: (id: string) =>
      api(`/api/tasks/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: 'Done' }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['notifications'] })
      toast('Task completed — admin notified', 'success')
    },
    onError: (e: Error) => toast(e.message || 'Could not complete', 'error'),
  })

  const reopenMut = useMutation({
    mutationFn: (id: string) =>
      api(`/api/tasks/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: 'Todo' }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      toast('Task marked incomplete', 'success')
    },
    onError: (e: Error) => toast(e.message || 'Could not reopen', 'error'),
  })

  const deleteDone = useMutation({
    mutationFn: (id: string) => api(`/api/tasks/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })

  const tasks = tasksQ.data || []
  const users = usersQ.data || []
  const notifs = notifQ.data?.items || []
  const counts = statsQ.data?.counts || {}
  const pipeline = statsQ.data?.shipmentPipeline || []
  const attention = statsQ.data?.attention || []
  const commissions = commissionsQ.data || {}
  const myId = user?.userId || ''

  const todos = useMemo(
    () => tasks.filter((t) => t.status === 'Todo' || t.status === 'In progress'),
    [tasks],
  )
  const openTasks = useMemo(
    () => tasks.filter((t) => t.status !== 'Done' && t.status !== 'Cancelled'),
    [tasks],
  )
  const myOpenTasks = useMemo(
    () =>
      openTasks.filter((t) => {
        const aid = optimisticAssignee[t._id] || assigneeId(t)
        return aid && myId && aid === myId
      }),
    [openTasks, myId, optimisticAssignee],
  )
  const done = useMemo(
    () =>
      tasks
        .filter((t) => t.status === 'Done')
        .sort(
          (a, b) =>
            new Date(b.completedAt || b.updatedAt || 0).getTime() -
            new Date(a.completedAt || a.updatedAt || 0).getTime(),
        ),
    [tasks],
  )

  const openByUser = useMemo(() => {
    const map: Record<string, number> = {}
    for (const t of openTasks) {
      const id = optimisticAssignee[t._id] || assigneeId(t)
      if (!id) continue
      map[id] = (map[id] || 0) + 1
    }
    return map
  }, [openTasks, optimisticAssignee])

  const userNameById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const u of users) m[u._id] = u.displayName || u.username || 'Employee'
    return m
  }, [users])

  function clearDrag() {
    setDragKind(null)
    setDragTaskId(null)
    setDragUserId(null)
    setHoverTargetId(null)
    setCursor(null)
  }

  function assignToUser(userId: string, taskId: string | null) {
    if (!taskId) return
    if (!isAdmin) {
      toast('Only admins can assign tasks', 'error')
      clearDrag()
      setPickedTaskId(null)
      return
    }
    assignMut.mutate({ taskId, userId })
    clearDrag()
    setPickedTaskId(null)
  }

  function onPickTask(taskId: string) {
    if (!isAdmin) return
    setPickedTaskId((prev) => (prev === taskId ? null : taskId))
  }

  function onTapEmployee(userId: string) {
    if (!pickedTaskId) return
    assignToUser(userId, pickedTaskId)
  }

  function updateCursor(e: React.DragEvent | DragEvent) {
    const board = boardRef.current
    if (!board) return
    const rect = board.getBoundingClientRect()
    setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  useEffect(() => {
    if (!dragKind) return
    function onMove(e: DragEvent) {
      updateCursor(e)
    }
    function onEnd() {
      clearDrag()
    }
    window.addEventListener('dragover', onMove)
    window.addEventListener('dragend', onEnd)
    window.addEventListener('drop', onEnd)
    return () => {
      window.removeEventListener('dragover', onMove)
      window.removeEventListener('dragend', onEnd)
      window.removeEventListener('drop', onEnd)
    }
  }, [dragKind])

  const linePath = useMemo(() => {
    if (!dragKind || !cursor || !boardRef.current) return null
    const fromKey =
      dragKind === 'task' ? `task:${dragTaskId}` : dragKind === 'user' ? `user:${dragUserId}` : ''
    const toKey =
      dragKind === 'task' && hoverTargetId
        ? `user:${hoverTargetId}`
        : dragKind === 'user' && hoverTargetId
          ? `task:${hoverTargetId}`
          : ''
    const from = centerOf(itemRefs.current[fromKey] || null, boardRef.current)
    if (!from) return null
    const to = toKey ? centerOf(itemRefs.current[toKey] || null, boardRef.current) : cursor
    if (!to) return null
    const dx = Math.max(40, Math.abs(to.x - from.x) * 0.45)
    const c1x = from.x + (to.x >= from.x ? dx : -dx)
    const c2x = to.x + (to.x >= from.x ? -dx : dx)
    return `M ${from.x} ${from.y} C ${c1x} ${from.y}, ${c2x} ${to.y}, ${to.x} ${to.y}`
  }, [dragKind, dragTaskId, dragUserId, hoverTargetId, cursor])

  function taskSubtitle(t: Task) {
    const aid = optimisticAssignee[t._id] || assigneeId(t)
    const name = aid ? userNameById[aid] || assigneeName(t) : 'Unassigned'
    const due = t.dueDate ? ` · Due ${formatDate(t.dueDate)}` : ''
    const flash =
      justAssigned?.taskId === t._id ? ` · Assigned to ${userNameById[justAssigned.userId] || 'employee'}` : ''
    return `${t.status || 'Todo'} · ${name}${due}${flash}`
  }

  function renderTaskCard(t: Task, opts?: { showPriority?: boolean }) {
    const isDragging = dragTaskId === t._id
    const isHover = dragKind === 'user' && hoverTargetId === t._id
    const isFlash = justAssigned?.taskId === t._id
    return (
      <div
        key={t._id}
        ref={(el) => {
          itemRefs.current[`task:${t._id}`] = el
        }}
        className={`ws-item ws-task${pickedTaskId === t._id ? ' is-picked' : ''}${isDragging ? ' is-dragging' : ''}${isHover ? ' is-drop-hover' : ''}${isFlash ? ' is-just-assigned' : ''}`}
        draggable={isAdmin}
        onDragStart={(e) => {
          if (!isAdmin) return
          e.dataTransfer.setData('text/task-id', t._id)
          e.dataTransfer.effectAllowed = 'link'
          setDragKind('task')
          setDragTaskId(t._id)
          setDragUserId(null)
          updateCursor(e)
        }}
        onDragEnd={clearDrag}
        onDragOver={(e) => {
          if (dragKind !== 'user') return
          e.preventDefault()
          setHoverTargetId(t._id)
          updateCursor(e)
        }}
        onDragLeave={() => {
          if (hoverTargetId === t._id) setHoverTargetId(null)
        }}
        onDrop={(e) => {
          e.preventDefault()
          const uid = e.dataTransfer.getData('text/user-id') || dragUserId
          if (uid) assignToUser(uid, t._id)
        }}
        onClick={() => onPickTask(t._id)}
        role={isAdmin ? 'button' : undefined}
        tabIndex={isAdmin ? 0 : undefined}
      >
        <span className="ws-port" aria-hidden="true" />
        <div className="ws-item-body">
          <span className="ws-item-title">{t.title}</span>
          <span className="ws-item-sub">
            {opts?.showPriority ? t.priority || 'Medium' : taskSubtitle(t)}
            {opts?.showPriority && t.dueDate ? ` · Due ${formatDate(t.dueDate)}` : ''}
          </span>
        </div>
        {t.status !== 'Done' && t.status !== 'Cancelled' ? (
          <button
            type="button"
            className="action-btn"
            onClick={(e) => {
              e.stopPropagation()
              completeMut.mutate(t._id)
            }}
            disabled={completeMut.isPending}
          >
            Complete
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <>
      <header className="page-header page-header-dash">
        <div>
          <h1>Dashboard</h1>
          <p className="page-lede">Assign work, then track shipments, indents, and open commissions.</p>
        </div>
      </header>

      <section className="dash-inbox" aria-label="Notifications">
        <div className="dash-inbox-head">
          <div>
            <h2>Notifications</h2>
            <p>Approvals, assignments, and security alerts</p>
          </div>
          <div className="dash-inbox-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending || notifs.length === 0}
            >
              Mark all read
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                if (!notifs.length) return
                if (window.confirm('Clear all notifications? This cannot be undone.')) {
                  clearAll.mutate()
                }
              }}
              disabled={clearAll.isPending || notifs.length === 0}
            >
              Clear all
            </button>
          </div>
        </div>
        <div className="dash-inbox-list">
          {notifQ.isLoading ? (
            <div className="dash-inbox-empty">Loading…</div>
          ) : notifs.length === 0 ? (
            <div className="dash-inbox-empty">You&apos;re all caught up.</div>
          ) : (
            notifs.map((n) => {
              const pendingAccess =
                isAdmin &&
                n.type === 'access_request' &&
                Boolean(n.accessRequestId) &&
                n.meta?.status !== 'approved' &&
                n.meta?.status !== 'denied'
              return (
                <div key={n._id} className={`sugar-notif-item is-card${n.read ? '' : ' is-unread'}`}>
                  <div className="sugar-notif-meta">
                    <span className="sugar-notif-tag">{notifTag(n.type)}</span>
                    <time>{n.createdAt ? formatDate(n.createdAt) : ''}</time>
                  </div>
                  <strong>{n.title || 'Update'}</strong>
                  <span>{n.message}</span>
                  <div className="sugar-notif-actions">
                    {pendingAccess ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={reviewAccess.isPending}
                          onClick={() =>
                            reviewAccess.mutate({ id: String(n.accessRequestId), approve: true })
                          }
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={reviewAccess.isPending}
                          onClick={() =>
                            reviewAccess.mutate({ id: String(n.accessRequestId), approve: false })
                          }
                        >
                          Deny
                        </button>
                      </>
                    ) : n.href ? (
                      <Link className="sugar-notif-link" to={n.href.startsWith('/') ? n.href : '/'}>
                        Open
                      </Link>
                    ) : null}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>

      {!isAdmin && myOpenTasks.length > 0 ? (
        <section className="dash-my-work" aria-label="My tasks" id="assign-work">
          <div className="dash-ops-head">
            <h2>My tasks to complete</h2>
            <p>Assigned to you — due dates included</p>
          </div>
          <div className="ws-panel-list">
            {myOpenTasks.map((t) => (
              <div key={t._id} className="ws-item">
                <div className="ws-item-body">
                  <span className="ws-item-title">{t.title}</span>
                  <span className="ws-item-sub">
                    {t.status || 'Todo'}
                    {t.dueDate ? ` · Due ${formatDate(t.dueDate)}` : ' · No due date'}
                    {t.priority ? ` · ${t.priority}` : ''}
                  </span>
                </div>
                <button
                  type="button"
                  className="action-btn"
                  onClick={() => completeMut.mutate(t._id)}
                  disabled={completeMut.isPending}
                >
                  Complete
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="sugar-assign-workspace" aria-label="Task workspace" id={isAdmin ? 'assign-work' : undefined}>
        <div className="sugar-journey-head">
          <h2>Assign work</h2>
          <div className="sugar-journey-tools">
            <Link className="sugar-tool-sq" to="/tasks?new=1" title="New task">
              +
            </Link>
            <Link className="sugar-tool-sq" to="/tasks" title="Manage tasks">
              ☰
            </Link>
          </div>
        </div>

        <div
          className={`ws-board${dragKind ? ' is-linking' : ''}`}
          ref={boardRef}
          onDragOver={(e) => {
            if (dragKind) {
              e.preventDefault()
              updateCursor(e)
            }
          }}
        >
          {linePath ? (
            <svg className="ws-link-svg" aria-hidden="true">
              <path className="ws-link-path" d={linePath} />
              <circle
                className="ws-link-dot"
                cx={cursor?.x || 0}
                cy={cursor?.y || 0}
                r="4"
              />
            </svg>
          ) : null}

          <div className="ws-panel">
            <div className="ws-panel-head">
              <h3>Todo</h3>
              <span className="ws-count">{todos.length}</span>
            </div>
            <div className="ws-panel-list">
              {todos.length === 0 ? <div className="ws-empty">No open todos</div> : todos.map((t) => renderTaskCard(t))}
            </div>
          </div>

          <div className="ws-panel">
            <div className="ws-panel-head">
              <h3>Task names</h3>
              <span className="ws-count">{openTasks.length}</span>
            </div>
            <div className="ws-panel-list">
              {openTasks.length === 0 ? (
                <div className="ws-empty">
                  No tasks yet — <Link to="/tasks?new=1">create one</Link>
                </div>
              ) : (
                openTasks.map((t) => renderTaskCard(t, { showPriority: true }))
              )}
            </div>
          </div>

          <div className="ws-panel">
            <div className="ws-panel-head">
              <h3>Employees</h3>
              <span className="ws-count">{users.length}</span>
            </div>
            <div className="ws-panel-list">
              {users.map((u) => {
                const isHover = dragKind === 'task' && hoverTargetId === u._id
                const isFlash = justAssigned?.userId === u._id
                return (
                  <div
                    key={u._id}
                    ref={(el) => {
                      itemRefs.current[`user:${u._id}`] = el
                    }}
                    className={`ws-item ws-emp${pickedTaskId || dragKind === 'task' ? ' is-drop-target' : ''}${isHover ? ' is-drop-hover' : ''}${isFlash ? ' is-just-assigned' : ''}`}
                    draggable={isAdmin}
                    onDragStart={(e) => {
                      if (!isAdmin) return
                      e.dataTransfer.setData('text/user-id', u._id)
                      e.dataTransfer.effectAllowed = 'link'
                      setDragKind('user')
                      setDragUserId(u._id)
                      setDragTaskId(null)
                      updateCursor(e)
                    }}
                    onDragEnd={clearDrag}
                    onDragOver={(e) => {
                      if (dragKind !== 'task') return
                      e.preventDefault()
                      setHoverTargetId(u._id)
                      updateCursor(e)
                    }}
                    onDragLeave={() => {
                      if (hoverTargetId === u._id) setHoverTargetId(null)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      const tid = e.dataTransfer.getData('text/task-id') || dragTaskId
                      if (tid) assignToUser(u._id, tid)
                    }}
                    onClick={() => onTapEmployee(u._id)}
                    role={pickedTaskId ? 'button' : undefined}
                    tabIndex={pickedTaskId ? 0 : undefined}
                  >
                    <span className="ws-port" aria-hidden="true" />
                    <span className="ws-av">{initials(u.displayName || u.username || '?')}</span>
                    <div className="ws-item-body">
                      <span className="ws-item-title">{u.displayName || u.username}</span>
                      <span className="ws-item-sub">{openByUser[u._id] || 0} open tasks</span>
                    </div>
                    <span className="ws-port" aria-hidden="true" />
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <p className="ws-hint ws-hint-desktop">
          {isAdmin
            ? 'Drag a task onto an employee (or an employee onto a task) to assign. A line shows the link.'
            : 'Only admins can assign tasks. Your assigned work is listed above when available.'}
        </p>
        <p className="ws-hint ws-hint-mobile">
          {isAdmin
            ? pickedTaskId
              ? 'Tap an employee to assign the selected task.'
              : 'Tap a task, then tap an employee to assign.'
            : 'Only admins can assign tasks. You can view the board here.'}
        </p>

        <div className="ws-done-block">
          <div className="ws-panel-head">
            <h3>Completed</h3>
            <span className="ws-count">{done.length}</span>
          </div>
          <p className="ws-done-note">Done tasks stay here for 3 days, then auto-remove. Delete anytime.</p>
          <div className="ws-panel-list ws-done-list">
            {done.length === 0 ? (
              <div className="ws-empty">No completed tasks</div>
            ) : (
              done.map((t) => (
                <div key={t._id} className="ws-item is-done">
                  <div className="ws-item-body">
                    <span className="ws-item-title">{t.title}</span>
                    <span className="ws-item-sub">{assigneeName(t)}</span>
                  </div>
                  <div className="ws-item-actions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="action-btn"
                      onClick={() => reopenMut.mutate(t._id)}
                      disabled={reopenMut.isPending}
                    >
                      Mark incomplete
                    </button>
                    {canDelete ? (
                      <button
                        type="button"
                        className="action-btn"
                        onClick={() => {
                          if (window.confirm('Delete this completed task?')) deleteDone.mutate(t._id)
                        }}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="dash-ops" aria-label="Operations">
        <div className="dash-ops-head">
          <h2>Operations</h2>
          <p>Shipments, indents, contracts, and commissions</p>
        </div>
        <div className="dash-ops-grid">
          <Link className="dash-ops-card" to="/shipments">
            <span className="dash-ops-label">Shipments</span>
            <span className="dash-ops-value">{counts.shipments ?? 0}</span>
            <span className="dash-ops-meta">
              {(pipeline.find((p) => p.status === 'In transit')?.count ?? 0) as number} in progress
            </span>
          </Link>
          <Link className="dash-ops-card" to="/indents">
            <span className="dash-ops-label">Indents</span>
            <span className="dash-ops-value">{counts.indents ?? 0}</span>
            <span className="dash-ops-meta">All purchase indents</span>
          </Link>
          <Link className="dash-ops-card" to="/sales-contracts">
            <span className="dash-ops-label">Contracts</span>
            <span className="dash-ops-value">{counts.contracts ?? 0}</span>
            <span className="dash-ops-meta">Sales contracts</span>
          </Link>
          <Link className="dash-ops-card" to="/commissions">
            <span className="dash-ops-label">Open commissions</span>
            <span className="dash-ops-value">
              {commissions.openCount ?? commissions.totalRecords ?? 0}
            </span>
            <span className="dash-ops-meta">{commissions.totalRecords ?? 0} total records</span>
          </Link>
        </div>

        <div className="dash-ops-columns">
          <div className="dash-ops-panel">
            <h3>Shipment pipeline</h3>
            <div className="dash-ops-list">
              {(pipeline.length
                ? pipeline
                : ['Draft', 'Booked', 'In transit', 'Arrived', 'Delivered'].map((status) => ({
                    status,
                    count: 0,
                  }))
              ).map((step) => (
                <Link
                  key={step.status}
                  className="dash-ops-row"
                  to={`/shipments?status=${encodeURIComponent(step.status)}`}
                >
                  <strong>{step.status}</strong>
                  <span>{step.count ?? 0}</span>
                </Link>
              ))}
            </div>
          </div>
          <div className="dash-ops-panel">
            <h3>Needs attention</h3>
            <div className="dash-ops-list">
              {attention.length === 0 ? (
                <div className="ws-empty">Nothing needs attention</div>
              ) : (
                attention.map((a, i) => (
                  <Link key={i} className="dash-ops-row" to={a.href || '/'}>
                    <strong>{a.title || 'Item'}</strong>
                    <span>{a.detail || a.meta || ''}</span>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
