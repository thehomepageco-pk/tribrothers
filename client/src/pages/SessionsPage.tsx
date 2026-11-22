import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { PageHeader } from '@/components/PageHeader'
import { formatSessionActivity, sessionRole, sessionUser } from '@/lib/sessionActivity'
import type { SessionEvent } from '@/types'

export default function SessionsPage() {
  useEffect(() => {
    document.title = 'Activity & Sessions'
  }, [])

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<SessionEvent[]>('/api/sessions'),
  })

  const events = Array.isArray(data) ? data : []

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Activity & Sessions"
        lede="Recent logins and changes made by users."
        actions={
          <button type="button" className="action-btn" onClick={() => void refetch()} disabled={isFetching}>
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      {error ? (
        <div className="panel" role="alert" style={{ color: 'var(--error)' }}>
          {error instanceof Error ? error.message : 'Failed to load sessions'}
        </div>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>Role</th>
              <th>What happened</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="empty-state">Loading…</td>
              </tr>
            ) : events.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-state">No activity yet.</td>
              </tr>
            ) : (
              events.map((ev, i) => (
                <tr key={ev._id || i}>
                  <td>{ev.createdAt ? new Date(ev.createdAt).toLocaleString() : '—'}</td>
                  <td>{sessionUser(ev) === 'A user' ? '—' : sessionUser(ev)}</td>
                  <td>
                    <span className="badge">{sessionRole(ev)}</span>
                  </td>
                  <td>{formatSessionActivity(ev)}</td>
                  <td>{ev.ip || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
