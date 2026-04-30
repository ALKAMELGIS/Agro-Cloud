import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { normalizeEmail, normalizeRole } from '../lib/auth'

type AuthUser = {
  id: number
  name: string
  email: string
  role: string
  scope?: string
}

type LoginProps = {
  onLogin: (user: AuthUser) => void
}

export default function Login({ onLogin }: LoginProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('Viewer')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [info, setInfo] = useState('')
  const [inviteToken, setInviteToken] = useState<string>('')
  const location = useLocation()
  const roleDropdownRef = useRef<HTMLDivElement | null>(null)
  const [isRoleOpen, setIsRoleOpen] = useState(false)

  const hashPassword = async (value: string) => {
    const encoder = new TextEncoder()
    const data = encoder.encode(value)
    const buffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(buffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const emailTrimmed = email.trim()
    const nameTrimmed = name.trim()
    if (!emailTrimmed || !password || (mode === 'signup' && !nameTrimmed)) {
      setError('All required fields must be filled.')
      return
    }
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailPattern.test(emailTrimmed)) {
      setError('Email format is invalid.')
      return
    }
    setIsSubmitting(true)
    setError('')
    try {
      const roleOverrideForEmail = (value: unknown): string | null => {
        const e = normalizeEmail(value)
        if (e === 'alkamelgeo@gmail.com') return 'Admin'
        if (e === 'mohamed.abass@eliteprojects.ae') return 'Manager'
        return null
      }
      const roleOrder = ['Viewer', 'Editor', 'Admin Manager', 'Admin', 'Manager'] as const
      const roleRank = (r: unknown) => roleOrder.indexOf(normalizeRole(r))
      const bestRole = (roles: unknown[]) =>
        roles.reduce((best, r) => (roleRank(r) > roleRank(best) ? normalizeRole(r) : normalizeRole(best)), 'Viewer' as string)

      const stored = localStorage.getItem('adminUsers')
      let users: any[] = []
      if (stored) {
        try {
          const parsed = JSON.parse(stored)
          if (Array.isArray(parsed)) {
            users = parsed
          }
        } catch {
          setError('User data is corrupted.')
          setIsSubmitting(false)
          return
        }
      }

      const normalizedUsers = users
        .map(u => {
          if (!u || typeof u !== 'object') return null
          const nextEmail = String((u as any).email || '').trim()
          if (!nextEmail) return null
          const override = roleOverrideForEmail(nextEmail)
          return { ...(u as any), email: nextEmail, role: normalizeRole(override ?? (u as any).role) }
        })
        .filter(Boolean) as any[]

      if (mode === 'signup') {
        const matches = normalizedUsers.filter(u => normalizeEmail(u.email) === normalizeEmail(emailTrimmed))
        const anyHasPassword = matches.some(m => typeof m.passwordHash === 'string' && m.passwordHash.length > 0)
        if (matches.length && anyHasPassword) {
          setError('An account with this email already exists.')
          setIsSubmitting(false)
          return
        }
        if (matches.length && !inviteToken) {
          setError('This email already has a pending invitation. Please use your invitation link to complete signup.')
          setIsSubmitting(false)
          return
        }
        if (matches.length && !matches.some(m => String(m.verificationToken || '') === String(inviteToken || ''))) {
          setError('Invitation link is invalid or expired.')
          setIsSubmitting(false)
          return
        }
        if (password.length < 8) {
          setError('Password must be at least 8 characters.')
          setIsSubmitting(false)
          return
        }
        const hashed = await hashPassword(password)
        const override = roleOverrideForEmail(emailTrimmed)
        const newUser = matches.length
          ? (() => {
              const base = matches[0] as any
              return {
                ...base,
                name: nameTrimmed,
                email: emailTrimmed,
                role: normalizeRole(override ?? base.role ?? role),
                status: 'Active',
                lastLogin: base.lastLogin || 'Never',
                passwordHash: hashed,
                emailVerified: true,
                verificationToken: undefined,
              }
            })()
          : {
              id: Date.now(),
              name: nameTrimmed,
              email: emailTrimmed,
              role: normalizeRole(override ?? role),
              status: 'Active',
              lastLogin: 'Never',
              passwordHash: hashed,
              emailVerified: true,
              verificationToken:
                typeof crypto !== 'undefined' && 'randomUUID' in crypto
                  ? (crypto as any).randomUUID()
                  : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            }
        const nextUsers = normalizedUsers.filter(u => normalizeEmail(u.email) !== normalizeEmail(emailTrimmed))
        nextUsers.push(newUser)
        localStorage.setItem('adminUsers', JSON.stringify(nextUsers))
        setInfo(matches.length ? 'Your invitation has been accepted. Please sign in.' : `We have sent a confirmation email to ${email}. Please check your inbox to confirm.`)
        setError('')
        setMode('signin')
        setInviteToken('')
      } else {
        if (password.length < 8) {
          setError('Password must be at least 8 characters.')
          setIsSubmitting(false)
          return
        }
        const matches = normalizedUsers.filter(u => normalizeEmail(u.email) === normalizeEmail(emailTrimmed))
        if (!matches.length) {
          setError('Invalid email or password.')
          setIsSubmitting(false)
          return
        }
        const hashed = await hashPassword(password)
        const anyHasPassword = matches.some(m => typeof m.passwordHash === 'string' && m.passwordHash.length > 0)
        const passwordMatches = anyHasPassword
          ? matches.filter(m => typeof m.passwordHash === 'string' && m.passwordHash === hashed)
          : matches

        if (!passwordMatches.length) {
          setError('Invalid email or password.')
          setIsSubmitting(false)
          return
        }

        const override = roleOverrideForEmail(emailTrimmed)
        const desiredRole = normalizeRole(override ?? bestRole(matches.map(m => m.role)))
        const desiredScope =
          matches.map(m => (m.scope ? String(m.scope).trim() : '')).find(v => v) ||
          (passwordMatches[0].scope ? String(passwordMatches[0].scope).trim() : '') ||
          ''
        const desiredManagedById =
          matches.map(m => (typeof m.managedById === 'number' ? m.managedById : null)).find(v => typeof v === 'number') ?? undefined

        const base = passwordMatches.reduce((best, u) => (roleRank(u.role) > roleRank(best?.role) ? u : best), passwordMatches[0] as any)
        const mergedUser = {
          ...base,
          email: emailTrimmed,
          role: desiredRole,
          scope: desiredScope || undefined,
          managedById: desiredManagedById,
          lastLogin: new Date().toLocaleString(),
          passwordHash: typeof base.passwordHash === 'string' ? base.passwordHash : hashed,
        }

        const nextUsers = normalizedUsers.filter(u => normalizeEmail(u.email) !== normalizeEmail(emailTrimmed))
        nextUsers.push(mergedUser)
        localStorage.setItem('adminUsers', JSON.stringify(nextUsers))

        const authUser: AuthUser = {
          id: typeof mergedUser.id === 'number' ? mergedUser.id : Date.now(),
          name: String(mergedUser.name || mergedUser.email),
          email: String(mergedUser.email || '').trim(),
          role: normalizeRole(mergedUser.role),
          scope: mergedUser.scope ? String(mergedUser.scope) : undefined,
        }
        localStorage.setItem('currentUser', JSON.stringify(authUser))
        onLogin(authUser)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const invite = params.get('invite')
    const token = params.get('token')
    const emailParam = params.get('email')
    if (invite && token && emailParam) {
      setMode('signup')
      setEmail(emailParam)
      setInviteToken(token)
      setInfo('Complete your invitation by setting your password.')
      setError('')
      return
    }

    const verifyToken = params.get('verify')
    if (!verifyToken) return
    const stored = localStorage.getItem('adminUsers')
    if (!stored) {
      setError('Invalid or expired verification link.')
      return
    }
    try {
      const parsed = JSON.parse(stored)
      if (!Array.isArray(parsed)) {
        setError('Invalid or expired verification link.')
        return
      }
      const users = parsed as any[]
      const index = users.findIndex(u => u.verificationToken === verifyToken)
      if (index === -1) {
        setError('Invalid or expired verification link.')
        return
      }
      const user = users[index]
      const updatedUser = {
        ...user,
        emailVerified: true,
        verificationToken: undefined
      }
      const nextUsers = [...users]
      nextUsers[index] = updatedUser
      localStorage.setItem('adminUsers', JSON.stringify(nextUsers))
      setInfo('Your email has been confirmed. Your account is pending approval by an Admin or Manager.')
      setError('')
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href)
        url.searchParams.delete('verify')
        window.history.replaceState({}, '', url.toString())
      }
    } catch {
      setError('Invalid or expired verification link.')
    }
  }, [location.search])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (roleDropdownRef.current && !roleDropdownRef.current.contains(event.target as Node)) {
        setIsRoleOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  return (
    <div className="login-page-root">
      <div className="login-bg-video" aria-hidden="true">
        <video
          id="banner-two"
          preload="metadata"
          className="video-background"
          poster="https://www.esri.com/content/dam/esrisites/en-us/parallax-gis/scene-poster.jpg"
          muted
          playsInline
          autoPlay
          loop
        >
          <source
            media="(min-width: 1024px)"
            src="https://www.esri.com/content/dam/esrisites/en-us/parallax-gis/wigis-scene-2-0521-large.mp4"
            type="video/mp4"
          />
          <source
            media="(min-width: 780px)"
            src="https://www.esri.com/content/dam/esrisites/en-us/parallax-gis/wigis-scene-2-0521-large.mp4"
            type="video/mp4"
          />
          <source
            src="https://www.esri.com/content/dam/esrisites/en-us/parallax-gis/wigis-scene-2-0521-large.mp4"
            type="video/mp4"
          />
        </video>
      </div>
      <div className="login-bg-overlay"></div>
      <div className="login-page-content">
        <div
          style={{
            width: '100%',
            maxWidth: '360px',
            background: 'radial-gradient(circle at top, rgba(15,23,42,0.96), rgba(15,23,42,0.92))',
            borderRadius: '18px',
            padding: '24px 24px 22px',
            boxShadow: '0 22px 70px rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(148, 163, 184, 0.45)',
            color: 'white'
          }}
        >
        <div style={{ marginBottom: '20px', textAlign: 'center' }}>
          <div className="login-logo-wrap">
            <img
              src="https://eliteprojects.ae/wp-content/uploads/2022/07/logo-retraced-white-03.png"
              alt="Elite Agro Projects"
            />
          </div>
          <div className="login-leaf-badge">
            <div className="login-leaf-circle">
              <i className="fa-solid fa-leaf"></i>
            </div>
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: '18px',
              fontWeight: 700,
              letterSpacing: '-0.03em'
            }}
          >
            Agro Cloud
          </h1>
          <div
            style={{
              marginTop: '14px',
              display: 'inline-flex',
              borderRadius: '999px',
              padding: '2px',
              background: 'rgba(15,23,42,0.9)',
              border: '1px solid rgba(55, 65, 81, 0.9)'
            }}
          >
            <button
              type="button"
              onClick={() => {
                setMode('signin')
                setError('')
                  setInfo('')
              }}
              style={{
                padding: '5px 14px',
                borderRadius: '999px',
                border: 'none',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                background: mode === 'signin' ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'transparent',
                color: mode === 'signin' ? '#ecfdf5' : '#cbd5f5',
                boxShadow: mode === 'signin' ? '0 8px 18px rgba(34,197,94,0.55)' : 'none',
                transition: 'all 0.2s ease'
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup')
                setError('')
                  setInfo('')
              }}
              style={{
                padding: '5px 14px',
                borderRadius: '999px',
                border: 'none',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                background: mode === 'signup' ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'transparent',
                color: mode === 'signup' ? '#ecfdf5' : '#cbd5f5',
                boxShadow: mode === 'signup' ? '0 8px 18px rgba(34,197,94,0.55)' : 'none',
                transition: 'all 0.2s ease'
              }}
            >
              Sign up
            </button>
          </div>
        </div>
        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <div
              style={{
                marginBottom: '10px',
                display: 'flex',
                justifyContent: 'center'
              }}
            >
              <div style={{ width: '100%', maxWidth: '280px' }}>
                <label
                  htmlFor="signup-name"
                  style={{
                    display: 'block',
                    fontSize: '11px',
                    fontWeight: 600,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'rgba(226, 232, 240, 0.92)',
                    marginBottom: '5px',
                    paddingInline: '2px'
                  }}
                >
                  Full name
                </label>
                <div
                  style={{
                    borderRadius: '12px',
                    padding: '6px 9px 7px',
                    background:
                      'radial-gradient(circle at top left, rgba(15,23,42,0.96), rgba(15,23,42,0.9))',
                    border: '1px solid rgba(148, 163, 184, 0.5)',
                    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.85)'
                  }}
                >
                  <input
                    id="signup-name"
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    autoComplete="name"
                    style={{
                      width: '100%',
                      padding: '4px 0 3px',
                      borderRadius: '0',
                      border: 'none',
                      background: 'transparent',
                      color: 'white',
                      fontSize: '12px',
                      outline: 'none'
                    }}
                  />
                </div>
              </div>
            </div>
          )}
          <div
            style={{
              marginBottom: '10px',
              display: 'flex',
              justifyContent: 'center'
            }}
          >
            <div style={{ width: '100%', maxWidth: '280px' }}>
              <label
                htmlFor="login-email"
                style={{
                  display: 'block',
                  fontSize: '11px',
                  fontWeight: 600,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'rgba(226, 232, 240, 0.92)',
                  marginBottom: '5px',
                  paddingInline: '2px'
                }}
              >
                Email
              </label>
              <div
                style={{
                  borderRadius: '12px',
                  padding: '6px 9px 7px',
                  background:
                    'radial-gradient(circle at top left, rgba(15,23,42,0.96), rgba(15,23,42,0.9))',
                  border: '1px solid rgba(148, 163, 184, 0.5)',
                  boxShadow: '0 10px 24px rgba(15, 23, 42, 0.85)'
                }}
              >
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                  style={{
                    width: '100%',
                    padding: '4px 0 3px',
                    borderRadius: '0',
                    border: 'none',
                    background: 'transparent',
                    color: 'white',
                    fontSize: '12px',
                    outline: 'none'
                  }}
                />
              </div>
            </div>
          </div>
          <div
            style={{
              marginBottom: '10px',
              display: 'flex',
              justifyContent: 'center'
            }}
          >
            <div style={{ width: '100%', maxWidth: '280px' }}>
              <label
                htmlFor="login-password"
                style={{
                  display: 'block',
                  fontSize: '11px',
                  fontWeight: 600,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'rgba(226, 232, 240, 0.92)',
                  marginBottom: '5px',
                  paddingInline: '2px'
                }}
              >
                Password
              </label>
              <div
                style={{
                  borderRadius: '12px',
                  padding: '6px 9px 7px',
                  background:
                    'radial-gradient(circle at top left, rgba(15,23,42,0.96), rgba(15,23,42,0.9))',
                  border: '1px solid rgba(148, 163, 184, 0.5)',
                  boxShadow: '0 10px 24px rgba(15, 23, 42, 0.85)'
                }}
              >
                <input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  style={{
                    width: '100%',
                    padding: '4px 0 3px',
                    borderRadius: '0',
                    border: 'none',
                    background: 'transparent',
                    color: 'white',
                    fontSize: '12px',
                    outline: 'none'
                  }}
                />
              </div>
            </div>
          </div>
          {mode === 'signup' && (
            <div
              style={{
                marginBottom: '10px',
                display: 'flex',
                justifyContent: 'center'
              }}
            >
              <div style={{ width: '100%', maxWidth: '280px' }}>
                <label
                  htmlFor="signup-role"
                  style={{
                    display: 'block',
                    fontSize: '11px',
                    fontWeight: 600,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'rgba(226, 232, 240, 0.92)',
                    marginBottom: '5px',
                    paddingInline: '2px'
                  }}
                >
                  Role
                </label>
                <div
                  style={{
                    borderRadius: '12px',
                    padding: '6px 9px 7px',
                    background:
                      'radial-gradient(circle at top left, rgba(15,23,42,0.96), rgba(15,23,42,0.9))',
                    border: '1px solid rgba(148, 163, 184, 0.5)',
                    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.85)'
                  }}
                >
                  <div
                    ref={roleDropdownRef}
                    style={{
                      position: 'relative'
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setIsRoleOpen(open => !open)}
                      style={{
                        width: '100%',
                        padding: '4px 0 3px',
                        borderRadius: '0',
                        border: 'none',
                        background: 'transparent',
                        color: '#e5e7eb',
                        fontSize: '12px',
                        fontWeight: 500,
                        letterSpacing: '0.02em',
                        outline: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer'
                      }}
                    >
                      <span>{role}</span>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '18px',
                          height: '18px',
                          borderRadius: '999px',
                          background: 'rgba(15,23,42,0.9)',
                          border: '1px solid rgba(148,163,184,0.5)',
                          color: '#9ca3af',
                          fontSize: '10px'
                        }}
                      >
                        <i className={isRoleOpen ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'}></i>
                      </span>
                    </button>
                    {isRoleOpen && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 'calc(100% + 6px)',
                          left: 0,
                          right: 0,
                          borderRadius: '12px',
                          background:
                            'radial-gradient(circle at top left, rgba(15,23,42,0.98), rgba(15,23,42,0.94))',
                          border: '1px solid rgba(148, 163, 184, 0.7)',
                          boxShadow: '0 18px 40px rgba(15, 23, 42, 0.95)',
                          padding: '4px',
                          zIndex: 30
                        }}
                      >
                        {['Admin', 'Manager', 'Editor', 'Viewer'].map(option => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => {
                              setRole(option)
                              setIsRoleOpen(false)
                            }}
                            style={{
                              width: '100%',
                              border: 'none',
                              background:
                                role === option
                                  ? 'linear-gradient(135deg, rgba(34,197,94,0.22), rgba(16,185,129,0.18))'
                                  : 'transparent',
                              color: '#e5e7eb',
                              textAlign: 'left',
                              padding: '7px 8px',
                              borderRadius: '8px',
                              fontSize: '12px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              cursor: 'pointer'
                            }}
                          >
                            <span>{option}</span>
                            {role === option && (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: '16px',
                                  height: '16px',
                                  borderRadius: '999px',
                                  background: 'rgba(34,197,94,0.18)',
                                  color: '#4ade80',
                                  fontSize: '10px'
                                }}
                              >
                                <i className="fa-solid fa-check"></i>
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          {info && (
            <div
              style={{
                marginBottom: '10px',
                padding: '7px 9px',
                borderRadius: '6px',
                background: 'rgba(34, 197, 94, 0.08)',
                color: '#bbf7d0',
                fontSize: '12px',
                whiteSpace: 'pre-line'
              }}
            >
              {info}
            </div>
          )}
          {error && (
            <div
              style={{
                marginBottom: '10px',
                padding: '7px 9px',
                borderRadius: '6px',
                background: 'rgba(239, 68, 68, 0.1)',
                color: '#fecaca',
                fontSize: '12px'
              }}
            >
              {error}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                width: '100%',
                maxWidth: '220px',
                padding: '7px 12px',
                borderRadius: '999px',
                border: 'none',
                background: isSubmitting
                  ? 'linear-gradient(135deg, #16a34a, #22c55e)'
                  : 'linear-gradient(135deg, #22c55e, #16a34a)',
                boxShadow: '0 10px 22px rgba(34, 197, 94, 0.75)',
                color: 'white',
                fontWeight: 600,
                fontSize: '12px',
                cursor: isSubmitting ? 'default' : 'pointer',
                marginTop: '12px',
                letterSpacing: '0.03em'
              }}
            >
              {isSubmitting
                ? mode === 'signin'
                  ? 'Signing in...'
                  : 'Creating account...'
                : mode === 'signin'
                  ? 'Sign in'
                  : 'Create account'}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  )
}
