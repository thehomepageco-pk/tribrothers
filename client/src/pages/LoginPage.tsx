import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

export default function LoginPage() {
  const { user, loading, login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Always land on dashboard after login so staff aren't dumped onto a
  // forbidden deep-link that immediately shows the admin-unlock form.
  const target = '/'

  const canSubmit = Boolean(username.trim() && password) && !submitting

  useEffect(() => {
    document.title = 'Sign in — Tri Brothers'
    document.body.classList.add('login-page')
    document.body.classList.remove('app-layout', 'sidebar-open')
    return () => {
      document.body.classList.remove('login-page')
    }
  }, [])

  if (!loading && user?.authenticated) {
    return <Navigate to={target} replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!username.trim() || !password) {
      setError('Enter both username and password.')
      return
    }
    setSubmitting(true)
    try {
      await login(username.trim(), password)
      navigate(target, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid username or password.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-atmosphere" aria-hidden="true" />

      <main className="login-shell">
        <div className="login-card">
          <header className="login-header">
            <img
              className="login-logo-img"
              src="/img/tri-logo.png"
              alt="Tri Brothers"
              width={120}
              height={120}
              decoding="async"
            />
            <h1 className="login-title">Sign in</h1>
            <p className="login-subtitle">Access your quotations, contracts, and reports.</p>
          </header>

          <form onSubmit={onSubmit} noValidate>
            <div className="login-form-group">
              <label className="login-label" htmlFor="login-username">
                Username
              </label>
              <div className="login-input-wrap">
                <span className="login-form-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M20 21a8 8 0 1 0-16 0"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                    <path
                      d="M12 13a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    />
                  </svg>
                </span>
                <input
                  id="login-username"
                  type="text"
                  name="username"
                  placeholder="Enter your username"
                  autoComplete="username"
                  autoFocus
                  required
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </div>

            <div className="login-form-group">
              <label className="login-label" htmlFor="login-password">
                Password
              </label>
              <div className="login-input-wrap">
                <span className="login-form-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M7 11V8a5 5 0 0 1 10 0v3"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                    <path
                      d="M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    />
                  </svg>
                </span>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="login-toggle-pass"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {error ? (
              <div className="login-error" role="alert">
                {error}
              </div>
            ) : null}

            <button type="submit" className="btn login-button" disabled={!canSubmit}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="login-footer-hint">Need access? Ask your admin to create an account.</p>
        </div>
      </main>
    </div>
  )
}
