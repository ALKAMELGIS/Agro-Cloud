import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../pages/data-entry/EC.css'
import { hasPermission, normalizeEmail, normalizeRole, readCurrentUser, startSession } from '../../lib/auth'
import { appendAuditLog, readAuditLog } from '../../lib/audit'

type User = {
  id: number
  name: string
  email: string
  role: string
  scope?: string
  managedById?: number
  status: string
  lastLogin: string
  passwordHash?: string
   emailVerified?: boolean
   verificationToken?: string
}

type SortKey = keyof Pick<User, 'name' | 'email' | 'role' | 'scope' | 'status' | 'lastLogin'>

type SortConfig = {
  key: SortKey
  direction: 'asc' | 'desc'
}

export default function Users({ embedded }: { embedded?: boolean } = {}) {
  const navigate = useNavigate()
  const isEmbedded = Boolean(embedded)
  const [users, setUsers] = useState<User[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [newUser, setNewUser] = useState({
    name: '',
    email: '',
    password: '',
    role: 'Viewer',
    scope: '',
    managedById: '' as number | '',
    status: 'Active',
    lastLogin: 'Never'
  })
  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('All')
  const [statusFilter, setStatusFilter] = useState<string>('All')
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [isAuditOpen, setIsAuditOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [batchAction, setBatchAction] = useState<'enable' | 'disable' | 'resetPassword' | 'assignRole' | 'exportCsv'>('disable')
  const [batchRole, setBatchRole] = useState<string>('Viewer')
  const [isNarrow, setIsNarrow] = useState(false)

  const currentUser = useMemo(() => readCurrentUser(), [])
  const currentRole = useMemo(() => normalizeRole(currentUser?.role), [currentUser?.role])
  const canManageUsers = useMemo(() => hasPermission('admin.users.manage', currentRole), [currentRole])
  const isSuperManager = currentRole === 'Manager' || currentRole === 'Admin'
  const isAdminManager = currentRole === 'Admin Manager'
  const canImpersonate = currentRole === 'Admin'

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth <= 600)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const normalizeUser = (raw: any): User | null => {
    if (!raw || typeof raw !== 'object') return null
    const email = String(raw.email || '').trim()
    if (!email) return null
    const id = typeof raw.id === 'number' ? raw.id : Number(raw.id || 0)
    return {
      id: Number.isFinite(id) && id > 0 ? id : Date.now(),
      name: String(raw.name || email),
      email,
      role: normalizeRole(raw.role),
      scope: raw.scope ? String(raw.scope).trim() || undefined : undefined,
      managedById: typeof raw.managedById === 'number' ? raw.managedById : undefined,
      status: String(raw.status || 'Active'),
      lastLogin: String(raw.lastLogin || 'Never'),
      passwordHash: typeof raw.passwordHash === 'string' ? raw.passwordHash : undefined,
      emailVerified: typeof raw.emailVerified === 'boolean' ? raw.emailVerified : undefined,
      verificationToken: typeof raw.verificationToken === 'string' ? raw.verificationToken : undefined,
    }
  }

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    try {
      let toast = document.getElementById('ec-notification')
      if (!toast) {
        toast = document.createElement('div')
        toast.id = 'ec-notification'
        toast.className = 'ec-notification'
        toast.setAttribute('role', 'status')
        toast.setAttribute('aria-live', 'polite')
        document.body.appendChild(toast)
      }

      toast.textContent = message
      toast.className = `ec-notification show ${type}`

      window.setTimeout(() => {
        if (!toast) return
        toast.className = `ec-notification hide ${type}`
        window.setTimeout(() => {
          if (toast) toast.className = 'ec-notification'
        }, 420)
      }, 2600)
    } catch {}
  }

  const readProfileAvatar = (email: string): string | null => {
    try {
      const raw = localStorage.getItem('user_profiles_v1')
      if (!raw) return null
      const parsed = JSON.parse(raw) as any
      const entry = parsed?.[String(email || '').trim()]
      if (entry && typeof entry === 'object' && typeof entry.avatarDataUrl === 'string' && entry.avatarDataUrl.trim()) return entry.avatarDataUrl
      return null
    } catch {
      return null
    }
  }

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const clearSelection = () => setSelectedIds([])

  const appendUserAudit = (action: string, target?: { id?: string; email?: string }, meta?: any) => {
    if (!(currentRole === 'Manager' || currentRole === 'Admin Manager' || currentRole === 'Admin')) return
    appendAuditLog({
      entity: 'user',
      entityId: target?.id,
      action,
      meta: { targetEmail: target?.email, ...meta },
    })
  }

  const canManageUser = (u: User): boolean => {
    if (!canManageUsers) return false
    if (isSuperManager) return true
    if (isAdminManager) {
      if (currentUser?.email && u.email.toLowerCase() === currentUser.email.toLowerCase()) return true
      const scopeOk = String(u.scope || '') === String(currentUser?.scope || '')
      const managedOk = typeof u.managedById === 'number' && typeof currentUser?.id === 'number' && u.managedById === currentUser.id
      const roleOk = u.role === 'Editor' || u.role === 'Viewer'
      return scopeOk && managedOk && roleOk
    }
    return false
  }

  const canDeleteUser = (u: User): boolean => {
    if (!canManageUser(u)) return false
    if (currentUser?.email && u.email.toLowerCase() === currentUser.email.toLowerCase()) return false
    return true
  }

  const handleBack = () => {
    navigate('/', { state: { openGroup: 'admin' } })
  }

  useEffect(() => {
    let loadedUsers: User[] = []
    const stored = localStorage.getItem('adminUsers')
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) {
          const normalized = parsed.map(normalizeUser).filter(Boolean) as User[]
          const byEmail = new Map<string, User>()
          for (const u of normalized) byEmail.set(normalizeEmail(u.email), u)
          loadedUsers = Array.from(byEmail.values())
        }
      } catch {
      }
    }

    const storedCurrent = localStorage.getItem('currentUser')
    if (storedCurrent) {
      try {
        const parsedCurrent = JSON.parse(storedCurrent) as { id?: number; name?: string; email?: string; role?: string; scope?: string }
        if (parsedCurrent && parsedCurrent.email) {
          const exists = loadedUsers.some(u => normalizeEmail(u.email) === normalizeEmail(parsedCurrent.email))
          if (!exists) {
            const seededUser: User = {
              id: parsedCurrent.id || Date.now(),
              name: parsedCurrent.name || parsedCurrent.email,
              email: String(parsedCurrent.email).trim(),
              role: normalizeRole(parsedCurrent.role),
              scope: parsedCurrent.scope ? String(parsedCurrent.scope).trim() || undefined : undefined,
              status: 'Active',
              lastLogin: 'Never',
              emailVerified: true
            }
            loadedUsers = [...loadedUsers, seededUser]
          }
        }
      } catch {
      }
    }

    if (loadedUsers.length) {
      setUsers(loadedUsers)
      localStorage.setItem('adminUsers', JSON.stringify(loadedUsers))
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('adminUsers', JSON.stringify(users))
  }, [users])

  const validateEmail = (email: string) => {
    const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return pattern.test(email)
  }
  const hashPassword = async (password: string) => {
    const encoder = new TextEncoder()
    const data = encoder.encode(password)
    const buffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(buffer))
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    return hashHex
  }

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canManageUsers) {
      showToast('Unauthorized.', 'error')
      appendUserAudit('unauthorized_create', undefined, { reason: 'no_permission' })
      return
    }
    const nextName = newUser.name.trim()
    const nextEmail = newUser.email.trim()
    if (!nextName || !nextEmail) {
      showToast('Name and email are required.', 'error')
      return
    }
    if (!validateEmail(nextEmail)) {
      showToast('Email format is invalid.', 'error')
      return
    }
    const exists = users.some(u => normalizeEmail(u.email) === normalizeEmail(nextEmail) && u.id !== editingId)
    if (exists) {
      showToast('A user with this email already exists.', 'error')
      return
    }

    if (editingId !== null) {
      const existing = users.find(u => u.id === editingId)
      if (!existing) {
        showToast('User not found.', 'error')
        return
      }
      if (!canManageUser(existing)) {
        showToast('Unauthorized.', 'error')
        appendUserAudit('unauthorized_update', { id: String(existing.id), email: existing.email }, { reason: 'scope_or_hierarchy' })
        return
      }
      if (newUser.password && newUser.password.length < 8) {
        showToast('Password must be at least 8 characters.', 'error')
        return
      }
      const passwordHash = newUser.password ? await hashPassword(newUser.password) : existing.passwordHash

      const nextRole = isAdminManager && existing.role === 'Admin Manager' ? existing.role : newUser.role
      const nextScope =
        isAdminManager
          ? String(currentUser?.scope || existing.scope || '')
          : newUser.role === 'Admin Manager'
            ? newUser.scope.trim()
            : newUser.scope.trim()
      const nextManagedById =
        isAdminManager
          ? typeof currentUser?.id === 'number'
            ? currentUser.id
            : existing.managedById
          : typeof newUser.managedById === 'number'
            ? newUser.managedById
            : undefined

      if (!isAdminManager && nextRole === 'Admin Manager' && !String(nextScope || '').trim()) {
        showToast('Scope is required for Admin Manager.', 'error')
        return
      }

      setUsers(prev =>
        prev.map(user =>
          user.id === editingId
            ? {
                ...user,
                name: nextName,
                email: nextEmail,
                role: normalizeRole(nextRole),
                scope: nextScope || undefined,
                managedById: nextManagedById,
                status: newUser.status,
                lastLogin: newUser.lastLogin || user.lastLogin || 'Never',
                passwordHash
              }
            : user
        )
      )
      appendUserAudit('update', { id: String(existing.id), email: newUser.email }, { role: nextRole, scope: nextScope, managedById: nextManagedById })
      showToast('User updated.', 'success')
    } else {
      if (newUser.password && newUser.password.length < 8) {
        showToast('Password must be at least 8 characters.', 'error')
        return
      }
      const creatingRole = isAdminManager ? (newUser.role === 'Editor' || newUser.role === 'Viewer' ? newUser.role : 'Viewer') : newUser.role

      const creatingScope =
        isAdminManager
          ? String(currentUser?.scope || '').trim()
          : creatingRole === 'Admin Manager'
            ? newUser.scope.trim()
            : newUser.scope.trim()

      if (creatingRole === 'Admin Manager' && !creatingScope) {
        showToast('Scope is required for Admin Manager.', 'error')
        return
      }

      const creatingManagedById =
        isAdminManager
          ? typeof currentUser?.id === 'number'
            ? currentUser.id
            : undefined
          : typeof newUser.managedById === 'number'
            ? newUser.managedById
            : undefined
      const hasPassword = Boolean(newUser.password)
      const passwordHash = hasPassword ? await hashPassword(newUser.password) : undefined
      const verificationToken =
        !hasPassword
          ? typeof window !== 'undefined' && typeof window.crypto?.randomUUID === 'function'
            ? window.crypto.randomUUID()
            : String(Date.now())
          : undefined
      const user: User = {
        id: Date.now(),
        name: nextName,
        email: nextEmail,
        role: normalizeRole(creatingRole),
        scope: creatingScope || undefined,
        managedById: creatingManagedById,
        status: hasPassword ? newUser.status : 'Invited',
        lastLogin: newUser.lastLogin || 'Never',
        passwordHash,
        emailVerified: hasPassword ? true : false,
        verificationToken
      }
      setUsers([...users, user])
      appendUserAudit(hasPassword ? 'create' : 'invite', { id: String(user.id), email: user.email }, { role: creatingRole, scope: creatingScope, managedById: creatingManagedById })
      if (hasPassword) {
        showToast('User created.', 'success')
      } else {
        const base = typeof window !== 'undefined' ? window.location.origin : ''
        const inviteLink = `${base}/login?invite=1&token=${encodeURIComponent(verificationToken || '')}&email=${encodeURIComponent(user.email)}`
        showToast(`Invite link generated for ${user.email}.`, 'success')
        try {
          navigator.clipboard?.writeText?.(inviteLink)
        } catch {}
      }
    }
    setIsModalOpen(false)
    setEditingId(null)
    setNewUser({ name: '', email: '', password: '', role: 'Viewer', scope: '', managedById: '', status: 'Active', lastLogin: 'Never' })
    setCurrentPage(1)
  }

  const handleRequestDelete = (id: number) => {
    const target = users.find(u => u.id === id)
    if (!target) return
    if (!canDeleteUser(target)) {
      showToast('Unauthorized.', 'error')
      appendUserAudit('unauthorized_delete', { id: String(target.id), email: target.email }, { reason: 'scope_or_hierarchy' })
      return
    }
    setConfirmDeleteId(id)
  }

  const handleConfirmDelete = () => {
    if (confirmDeleteId === null) return
    const target = users.find(u => u.id === confirmDeleteId)
    if (target) {
      if (!canDeleteUser(target)) {
        showToast('Unauthorized.', 'error')
        appendUserAudit('unauthorized_delete', { id: String(target.id), email: target.email }, { reason: 'scope_or_hierarchy' })
        setConfirmDeleteId(null)
        return
      }
      setUsers(prev => prev.filter(u => u.id !== confirmDeleteId))
      appendUserAudit('delete', { id: String(target.id), email: target.email })
      showToast('User deleted.', 'success')
    }
    setConfirmDeleteId(null)
  }

  const handleClearAll = () => {
    setUsers([])
    localStorage.removeItem('adminUsers')
  }

  const handleEditUser = (user: User) => {
    if (!canManageUser(user)) {
      showToast('Unauthorized.', 'error')
      appendUserAudit('unauthorized_update', { id: String(user.id), email: user.email }, { reason: 'scope_or_hierarchy' })
      return
    }
    setNewUser({
      name: user.name,
      email: user.email,
      password: '',
      role: user.role,
      scope: String(user.scope || ''),
      managedById: typeof user.managedById === 'number' ? user.managedById : '',
      status: user.status,
      lastLogin: user.lastLogin || 'Never'
    })
    setEditingId(user.id)
    setIsModalOpen(true)
  }

  const handleResetPassword = (user: User) => {
    if (!canManageUser(user)) {
      showToast('Unauthorized.', 'error')
      appendUserAudit('unauthorized_reset_password', { id: String(user.id), email: user.email }, { reason: 'scope_or_hierarchy' })
      return
    }
    appendUserAudit('reset_password', { id: String(user.id), email: user.email })
    showToast(`Password reset link sent to ${user.email}`, 'success')
  }

  const handleToggleStatus = (user: User) => {
    if (!canManageUser(user)) {
      showToast('Unauthorized.', 'error')
      appendUserAudit('unauthorized_toggle_status', { id: String(user.id), email: user.email }, { reason: 'scope_or_hierarchy' })
      return
    }
    setUsers(prev =>
      prev.map(u =>
        u.id === user.id
          ? {
              ...u,
              status: u.status === 'Active' ? 'Inactive' : 'Active'
            }
          : u
      )
    )
    appendUserAudit(user.status === 'Active' ? 'deactivate' : 'activate', { id: String(user.id), email: user.email })
    showToast(user.status === 'Active' ? 'User deactivated.' : 'User activated.', 'success')
  }

  const handleImpersonate = (user: User) => {
    if (!canImpersonate) return
    if (!user || !user.email) return
    const actor = readCurrentUser()
    if (!actor) return
    if (actor.email && actor.email.toLowerCase() === user.email.toLowerCase()) {
      showToast('You are already signed in as this user.', 'info')
      return
    }
    appendAuditLog({
      entity: 'user',
      action: 'impersonate',
      entityId: String(user.id),
      meta: { targetEmail: user.email, actorEmail: actor.email },
    })
    try {
      localStorage.setItem('impersonation_v1', JSON.stringify({ actor, target: { id: user.id, email: user.email } }))
    } catch {}
    const nextUser = { id: user.id, name: user.name, email: user.email, role: user.role, scope: user.scope }
    startSession(nextUser as any)
    try {
      localStorage.setItem('currentUser', JSON.stringify(nextUser))
    } catch {}
    navigate('/', { replace: true })
  }

  const handleSort = (key: SortKey) => {
    setSortConfig(prev => {
      if (prev && prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      }
      return { key, direction: 'asc' }
    })
  }

  const visibleUsers = useMemo(() => {
    if (!canManageUsers) return []
    if (isSuperManager) return users
    if (isAdminManager) {
      const me = currentUser?.email ? currentUser.email.toLowerCase() : ''
      const scope = String(currentUser?.scope || '')
      return users.filter(u => {
        if (me && u.email.toLowerCase() === me) return true
        const scopeOk = String(u.scope || '') === scope
        const managedOk = typeof u.managedById === 'number' && typeof currentUser?.id === 'number' && u.managedById === currentUser.id
        const roleOk = u.role === 'Editor' || u.role === 'Viewer'
        return scopeOk && managedOk && roleOk
      })
    }
    return []
  }, [users, canManageUsers, isSuperManager, isAdminManager, currentUser?.email, currentUser?.id, currentUser?.scope])

  const adminManagers = useMemo(() => visibleUsers.filter(u => u.role === 'Admin Manager'), [visibleUsers])
  const knownScopes = useMemo(() => {
    const set = new Set<string>()
    for (const u of users) {
      const s = String(u.scope || '').trim()
      if (s) set.add(s)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [users])

  const handleExportCsv = (list: User[] = filteredAndSorted) => {
    if (!list.length) {
      showToast('No users to export.', 'info')
      return
    }
    const headers = ['Name', 'Email', 'Role', 'Scope', 'Status', 'Last Login', 'Managed By Id']
    const rows = list.map(u => [
      u.name,
      u.email,
      u.role,
      u.scope || '',
      u.status,
      u.lastLogin || 'Never',
      typeof u.managedById === 'number' ? String(u.managedById) : ''
    ])
    const csv = [headers, ...rows]
      .map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'users.csv'
    link.click()
    URL.revokeObjectURL(url)
    appendUserAudit('export_csv', undefined, { count: list.length })
    showToast('Exported CSV.', 'success')
  }

  const filteredAndSorted = useMemo(() => {
    const term = searchTerm.toLowerCase()
    let result = visibleUsers.filter(user => {
      const matchesSearch =
        !term ||
        user.name.toLowerCase().includes(term) ||
        user.email.toLowerCase().includes(term)
      const matchesRole = roleFilter === 'All' || user.role === roleFilter
      const matchesStatus = statusFilter === 'All' || user.status === statusFilter
      return matchesSearch && matchesRole && matchesStatus
    })
    if (sortConfig) {
      result = [...result].sort((a, b) => {
        const aValue = a[sortConfig.key] || ''
        const bValue = b[sortConfig.key] || ''
        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1
        return 0
      })
    }
    return result
  }, [visibleUsers, searchTerm, roleFilter, statusFilter, sortConfig])

  const itemsPerPage = 10
  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / itemsPerPage))

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage
    return filteredAndSorted.slice(start, start + itemsPerPage)
  }, [filteredAndSorted, currentPage])

  const applyBatchAction = async () => {
    if (!selectedIds.length) return
    const selected = users.filter(u => selectedIds.includes(u.id))
    const manageable = selected.filter(canManageUser)
    if (!manageable.length) {
      showToast('No selected users can be managed.', 'error')
      return
    }

    if (batchAction === 'exportCsv') {
      handleExportCsv(manageable)
      clearSelection()
      return
    }

    if (batchAction === 'assignRole') {
      setUsers(prev => prev.map(u => (manageable.some(m => m.id === u.id) ? { ...u, role: normalizeRole(batchRole) } : u)))
      manageable.forEach(u => appendUserAudit('role_change', { id: String(u.id), email: u.email }, { to: batchRole }))
      showToast(`Role updated for ${manageable.length} users.`, 'success')
      clearSelection()
      return
    }

    if (batchAction === 'enable' || batchAction === 'disable') {
      const nextStatus = batchAction === 'enable' ? 'Active' : 'Inactive'
      setUsers(prev => prev.map(u => (manageable.some(m => m.id === u.id) ? { ...u, status: nextStatus } : u)))
      manageable.forEach(u => appendUserAudit('status_change', { id: String(u.id), email: u.email }, { to: nextStatus }))
      showToast(`Status updated for ${manageable.length} users.`, 'success')
      clearSelection()
      return
    }

    if (batchAction === 'resetPassword') {
      manageable.forEach(u => handleResetPassword(u))
      clearSelection()
      return
    }
  }

  const renderStatusPill = (status: string) => {
    let bg = '#e2e8f0'
    let color = '#0f172a'
    if (status === 'Active') {
      bg = '#dcfce7'
      color = '#166534'
    } else if (status === 'Inactive') {
      bg = '#e2e8f0'
      color = '#475569'
    } else if (status === 'Suspended') {
      bg = '#fee2e2'
      color = '#b91c1c'
    } else if (status === 'Invited') {
      bg = '#e0f2fe'
      color = '#0369a1'
    } else if (status === 'Deleted') {
      bg = '#f1f5f9'
      color = '#64748b'
    }
    return (
      <span
        style={{
          background: bg,
          color,
          padding: '4px 10px',
          borderRadius: '20px',
          fontSize: '11px',
          fontWeight: 600
        }}
      >
        {status}
      </span>
    )
  }

  const renderRolePill = (role: string) => {
    let bg = '#e0f2fe'
    let color = '#0369a1'
    if (role === 'Admin') {
      bg = '#ecfdf5'
      color = '#047857'
    } else if (role === 'Manager') {
      bg = '#fffbeb'
      color = '#92400e'
    } else if (role === 'Admin Manager') {
      bg = '#f5f3ff'
      color = '#6d28d9'
    } else if (role === 'Editor') {
      bg = '#eff6ff'
      color = '#1d4ed8'
    } else if (role === 'Viewer') {
      bg = '#f1f5f9'
      color = '#475569'
    }
    return (
      <span
        style={{
          background: bg,
          color,
          padding: '4px 10px',
          borderRadius: '20px',
          fontSize: '11px',
          fontWeight: 600
        }}
      >
        {role}
      </span>
    )
  }

  const hasUsers = filteredAndSorted.length > 0

  const auditEntries = useMemo(() => {
    const all = readAuditLog().filter(e => e && e.entity === 'user')
    if (isSuperManager) return all
    if (isAdminManager) {
      const me = currentUser?.email ? currentUser.email.toLowerCase() : ''
      return all.filter(e => (e.actorEmail || '').toLowerCase() === me)
    }
    return []
  }, [isSuperManager, isAdminManager, currentUser?.email, users.length])

  const canAddUser = canManageUsers
  const canSeeAudit = canManageUsers

  if (!canManageUsers) {
    return (
      <div className="ec-page">
        <div className="ec-container ec-animate-in">
          <div className="ec-card">
            <div className="ec-card-body" style={{ color: '#64748b', fontSize: 14 }}>
              Unauthorized.
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={isEmbedded ? undefined : 'page'} style={{ maxWidth: '1200px', margin: isEmbedded ? '0' : '0 auto' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {!isEmbedded ? (
            <button
              type="button"
              onClick={handleBack}
              aria-label="Back"
              title="Back"
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '12px',
                border: '1px solid rgba(148, 163, 184, 0.75)',
                background: 'radial-gradient(circle at top left, #0f172a, #020617)',
                color: '#f8fafc',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 14px 26px rgba(2, 6, 23, 0.25)'
              }}
            >
              <i className="fa-solid fa-chevron-left"></i>
            </button>
          ) : null}
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a', margin: 0 }}>User Management</h1>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={() => canSeeAudit && setIsAuditOpen(true)}
            disabled={!canSeeAudit}
            style={{
              padding: '8px 14px',
              borderRadius: '999px',
              border: '1px solid #e2e8f0',
              background: 'white',
              fontSize: '13px',
              fontWeight: 500,
              cursor: canSeeAudit ? 'pointer' : 'not-allowed',
              color: '#0f172a',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <i className="fa-solid fa-clipboard-list"></i>
            Audit Log
          </button>
          <button
            onClick={() => handleExportCsv()}
            disabled={!hasUsers}
            style={{
              padding: '8px 14px',
              borderRadius: '999px',
              border: '1px solid #e2e8f0',
              background: hasUsers ? '#ecfeff' : '#f8fafc',
              fontSize: '13px',
              fontWeight: 500,
              cursor: hasUsers ? 'pointer' : 'not-allowed',
              color: hasUsers ? '#0369a1' : '#94a3b8',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <i className="fa-solid fa-file-export"></i>
            Export CSV
          </button>
          <button
            onClick={() => {
              if (!canAddUser) return
              setEditingId(null)
              const baseRole = isAdminManager ? 'Viewer' : 'Viewer'
              const baseScope = isAdminManager ? String(currentUser?.scope || '') : ''
              setNewUser({ name: '', email: '', password: '', role: baseRole, scope: baseScope, managedById: isAdminManager && typeof currentUser?.id === 'number' ? currentUser.id : '', status: 'Active', lastLogin: 'Never' })
              setIsModalOpen(true)
            }}
            disabled={!canAddUser}
            style={{
              padding: '8px 16px',
              borderRadius: '999px',
              border: 'none',
              background: canAddUser ? '#10b981' : '#94a3b8',
              color: 'white',
              fontWeight: 600,
              fontSize: '13px',
              cursor: canAddUser ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 10px 20px rgba(16, 185, 129, 0.3)'
            }}
          >
            <i className="fa-solid fa-user-plus"></i>
            Add User
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '16px',
          alignItems: 'center'
        }}
      >
        <input
          type="text"
          placeholder="Search by name or email"
          value={searchTerm}
          onChange={e => {
            setSearchTerm(e.target.value)
            setCurrentPage(1)
          }}
          style={{
            flex: '1 1 220px',
            minWidth: '200px',
            padding: '8px 12px',
            borderRadius: '999px',
            border: '1px solid #e2e8f0',
            outline: 'none',
            fontSize: '13px'
          }}
        />
        <select
          value={roleFilter}
          onChange={e => {
            setRoleFilter(e.target.value)
            setCurrentPage(1)
          }}
          style={{
            padding: '8px 12px',
            borderRadius: '999px',
            border: '1px solid #e2e8f0',
            background: 'white',
            fontSize: '13px'
          }}
        >
          <option value="All">All Roles</option>
          {isSuperManager ? <option value="Admin">Admin</option> : null}
          {isSuperManager ? <option value="Manager">Manager</option> : null}
          {isSuperManager ? <option value="Admin Manager">Admin Manager</option> : null}
          <option value="Editor">Editor</option>
          <option value="Viewer">Viewer</option>
        </select>
        <select
          value={statusFilter}
          onChange={e => {
            setStatusFilter(e.target.value)
            setCurrentPage(1)
          }}
          style={{
            padding: '8px 12px',
            borderRadius: '999px',
            border: '1px solid #e2e8f0',
            background: 'white',
            fontSize: '13px'
          }}
        >
          <option value="All">All Statuses</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
          <option value="Suspended">Suspended</option>
          <option value="Invited">Invited</option>
          <option value="Deleted">Deleted</option>
        </select>
      </div>

      {selectedIds.length ? (
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            flexWrap: 'wrap',
            padding: '10px 12px',
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            background: '#f8fafc',
            marginBottom: 12,
          }}
          aria-label="Batch actions"
        >
          <div style={{ fontSize: 13, color: '#0f172a', fontWeight: 700 }}>{selectedIds.length} selected</div>
          <select
            value={batchAction}
            onChange={e => setBatchAction(e.target.value as any)}
            style={{ padding: '8px 12px', borderRadius: 999, border: '1px solid #e2e8f0', background: 'white', fontSize: 13 }}
            aria-label="Batch action"
          >
            <option value="enable">Enable</option>
            <option value="disable">Disable</option>
            <option value="resetPassword">Reset password</option>
            <option value="assignRole">Assign role</option>
            <option value="exportCsv">Export CSV</option>
          </select>
          {batchAction === 'assignRole' ? (
            <select
              value={batchRole}
              onChange={e => setBatchRole(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 999, border: '1px solid #e2e8f0', background: 'white', fontSize: 13 }}
              aria-label="Role"
            >
              {isSuperManager ? <option value="Admin">Admin</option> : null}
              {isSuperManager ? <option value="Manager">Manager</option> : null}
              {isSuperManager ? <option value="Admin Manager">Admin Manager</option> : null}
              <option value="Editor">Editor</option>
              <option value="Viewer">Viewer</option>
            </select>
          ) : null}
          <button type="button" className="ec-btn ec-btn-primary" onClick={applyBatchAction}>
            Apply
          </button>
          <button type="button" className="ec-btn ec-btn-ghost" onClick={clearSelection}>
            Clear
          </button>
        </div>
      ) : null}

      {paginatedUsers.length > 0 ? (
        <>
          {isNarrow ? (
            <div style={{ display: 'grid', gap: 10 }}>
              {paginatedUsers.map((user) => {
                const avatar = readProfileAvatar(user.email) || '/avatars/emirati-farmer.svg'
                const manageable = canManageUser(user)
                const checked = selectedIds.includes(user.id)
                return (
                  <div key={user.id} className="card" style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: 'white', padding: 14 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 10, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!manageable}
                        onChange={() => toggleSelected(user.id)}
                        aria-label={`Select ${user.email}`}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <img src={avatar} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', border: '1px solid #e2e8f0' }} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 800, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
                          <div style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        {renderRolePill(user.role)}
                        {renderStatusPill(user.status || 'Active')}
                      </div>
                    </div>
                    <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                      <div style={{ fontSize: 12, color: '#64748b' }}>Last login: {user.lastLogin || 'Never'}</div>
                      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                        {canImpersonate ? (
                          <button
                            style={{ border: 'none', background: 'none', color: '#7c3aed', cursor: 'pointer', fontSize: 16 }}
                            title="Impersonate"
                            onClick={() => handleImpersonate(user)}
                          >
                            <i className="fa-solid fa-user-secret"></i>
                          </button>
                        ) : null}
                        <button
                          style={{ border: 'none', background: 'none', color: manageable ? '#64748b' : '#cbd5e1', cursor: manageable ? 'pointer' : 'not-allowed', fontSize: 16 }}
                          title="Edit"
                          onClick={() => handleEditUser(user)}
                        >
                          <i className="fa-solid fa-pen"></i>
                        </button>
                        <button
                          style={{ border: 'none', background: 'none', color: canDeleteUser(user) ? '#ef4444' : '#cbd5e1', cursor: canDeleteUser(user) ? 'pointer' : 'not-allowed', fontSize: 16 }}
                          title={canDeleteUser(user) ? 'Delete' : 'Not allowed'}
                          onClick={() => handleRequestDelete(user.id)}
                        >
                          <i className="fa-solid fa-trash"></i>
                        </button>
                        <button
                          style={{ border: 'none', background: 'none', color: manageable ? '#0ea5e9' : '#cbd5e1', cursor: manageable ? 'pointer' : 'not-allowed', fontSize: 16 }}
                          title="Reset Password"
                          onClick={() => handleResetPassword(user)}
                        >
                          <i className="fa-solid fa-key"></i>
                        </button>
                        <button
                          style={{ border: 'none', background: 'none', color: manageable ? '#10b981' : '#cbd5e1', cursor: manageable ? 'pointer' : 'not-allowed', fontSize: 16 }}
                          title={user.status === 'Active' ? 'Deactivate User' : 'Activate User'}
                          onClick={() => handleToggleStatus(user)}
                        >
                          <i className={user.status === 'Active' ? 'fa-solid fa-user-slash' : 'fa-solid fa-user-check'}></i>
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '12px', background: 'white' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                    <th style={{ padding: '16px' }}>
                      <input
                        type="checkbox"
                        checked={paginatedUsers.length > 0 && paginatedUsers.every(u => selectedIds.includes(u.id))}
                        onChange={() => {
                          const pageIds = paginatedUsers.map(u => u.id)
                          const allSelected = pageIds.every(id => selectedIds.includes(id))
                          if (allSelected) {
                            setSelectedIds(prev => prev.filter(id => !pageIds.includes(id)))
                          } else {
                            setSelectedIds(prev => Array.from(new Set([...prev, ...pageIds.filter(id => !prev.includes(id))])))
                          }
                        }}
                        aria-label="Select all users on this page"
                      />
                    </th>
                    <th style={{ padding: '16px', fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Avatar</th>
                    <th onClick={() => handleSort('name')} style={{ padding: '16px', fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', cursor: 'pointer' }}>
                      Name
                    </th>
                    <th onClick={() => handleSort('email')} style={{ padding: '16px', fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', cursor: 'pointer' }}>
                      Email
                    </th>
                    <th onClick={() => handleSort('role')} style={{ padding: '16px', fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', cursor: 'pointer' }}>
                      Role
                    </th>
                    <th onClick={() => handleSort('status')} style={{ padding: '16px', fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', cursor: 'pointer' }}>
                      Status
                    </th>
                    <th onClick={() => handleSort('lastLogin')} style={{ padding: '16px', fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', cursor: 'pointer' }}>
                      Last Login
                    </th>
                    <th style={{ padding: '16px', fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedUsers.map((user, idx) => {
                    const avatar = readProfileAvatar(user.email) || '/avatars/emirati-farmer.svg'
                    const manageable = canManageUser(user)
                    return (
                      <tr key={user.id} style={{ borderBottom: idx < users.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                        <td style={{ padding: '16px' }}>
                          <input type="checkbox" checked={selectedIds.includes(user.id)} disabled={!manageable} onChange={() => toggleSelected(user.id)} aria-label={`Select ${user.email}`} />
                        </td>
                        <td style={{ padding: '16px' }}>
                          <img src={avatar} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', border: '1px solid #e2e8f0' }} />
                        </td>
                        <td style={{ padding: '16px', color: '#334155' }}>{user.name}</td>
                        <td style={{ padding: '16px', color: '#334155' }}>{user.email}</td>
                        <td style={{ padding: '16px' }}>{renderRolePill(user.role)}</td>
                        <td style={{ padding: '16px' }}>{renderStatusPill(user.status || 'Active')}</td>
                        <td style={{ padding: '16px', color: '#64748b' }}>{user.lastLogin || 'Never'}</td>
                        <td style={{ padding: '16px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                            {canImpersonate ? (
                              <button
                                style={{ border: 'none', background: 'none', color: '#7c3aed', cursor: 'pointer', fontSize: '16px' }}
                                title="Impersonate"
                                onClick={() => handleImpersonate(user)}
                              >
                                <i className="fa-solid fa-user-secret"></i>
                              </button>
                            ) : null}
                            <button
                              style={{ border: 'none', background: 'none', color: manageable ? '#64748b' : '#cbd5e1', cursor: manageable ? 'pointer' : 'not-allowed', fontSize: '16px' }}
                              title="Edit"
                              onClick={() => handleEditUser(user)}
                            >
                              <i className="fa-solid fa-pen"></i>
                            </button>
                            <button
                              style={{ border: 'none', background: 'none', color: canDeleteUser(user) ? '#ef4444' : '#cbd5e1', cursor: canDeleteUser(user) ? 'pointer' : 'not-allowed', fontSize: '16px' }}
                              title={canDeleteUser(user) ? 'Delete' : 'Not allowed'}
                              onClick={() => handleRequestDelete(user.id)}
                            >
                              <i className="fa-solid fa-trash"></i>
                            </button>
                            <button
                              style={{ border: 'none', background: 'none', color: manageable ? '#0ea5e9' : '#cbd5e1', cursor: manageable ? 'pointer' : 'not-allowed', fontSize: '16px' }}
                              title="Reset Password"
                              onClick={() => handleResetPassword(user)}
                            >
                              <i className="fa-solid fa-key"></i>
                            </button>
                            <button
                              style={{ border: 'none', background: 'none', color: manageable ? '#10b981' : '#cbd5e1', cursor: manageable ? 'pointer' : 'not-allowed', fontSize: '16px' }}
                              title={user.status === 'Active' ? 'Deactivate User' : 'Activate User'}
                              onClick={() => handleToggleStatus(user)}
                            >
                              <i className={user.status === 'Active' ? 'fa-solid fa-user-slash' : 'fa-solid fa-user-check'}></i>
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 16px',
                borderTop: '1px solid #e2e8f0',
                background: '#f8fafc',
                borderRadius: 12,
                marginTop: 10,
              }}
            >
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                Page {currentPage} of {totalPages}
              </span>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  style={{ padding: '4px 10px', borderRadius: '999px', border: '1px solid #e2e8f0', background: 'white', fontSize: '12px', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
                >
                  Prev
                </button>
                <button
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  style={{ padding: '4px 10px', borderRadius: '999px', border: '1px solid #e2e8f0', background: 'white', fontSize: '12px', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div
          className="card"
          style={{
            padding: '32px',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            background: 'white',
            textAlign: 'center',
            color: '#64748b',
            fontSize: '14px'
          }}
        >
          No users found. Use Add User to create the first user.
        </div>
      )}

      {isModalOpen && (
        <div className="ec-modal-overlay ec-modal-active">
          <div className="ec-modal">
            <div className="ec-modal-header">
              <h2 className="ec-modal-title">
                <i className="fa-solid fa-user-plus" style={{ color: '#047857' }}></i>
                {editingId !== null ? 'Edit User' : 'Add New User'}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="ec-modal-close-btn"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="ec-modal-body">
              <form
                onSubmit={handleAddUser}
                style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
              >
                <div className="ec-grid-2-col-wide">
                  <div className="ec-input-group">
                    <label className="ec-label">Name *</label>
                    <input
                      type="text"
                      required
                      value={newUser.name}
                      onChange={e => setNewUser({ ...newUser, name: e.target.value })}
                      className="ec-input"
                    />
                  </div>

                  <div className="ec-input-group">
                    <label className="ec-label">Email *</label>
                    <input
                      type="email"
                      required
                      value={newUser.email}
                      onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                      className="ec-input"
                    />
                  </div>

                  <div className="ec-input-group" style={{ gridColumn: '1 / -1' }}>
                    <label className="ec-label">Password</label>
                    <input
                      type="password"
                      value={newUser.password}
                      onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                      className="ec-input"
                    />
                    <span
                      style={{
                        fontSize: '0.7rem',
                        color: 'var(--ec-text-secondary)',
                        marginTop: '0.25rem'
                      }}
                    >
                      Must be at least 8 characters. Leave blank to send an invite link.
                    </span>
                  </div>

                  <div className="ec-input-group">
                    <label className="ec-label">Role</label>
                    <select
                      value={newUser.role}
                      onChange={e => setNewUser({ ...newUser, role: e.target.value })}
                      className="ec-input"
                      disabled={isAdminManager && !(newUser.role === 'Editor' || newUser.role === 'Viewer')}
                    >
                      {isSuperManager ? (
                        <>
                          <option value="Admin">Admin</option>
                          <option value="Manager">Manager</option>
                          <option value="Admin Manager">Admin Manager</option>
                          <option value="Editor">Editor</option>
                          <option value="Viewer">Viewer</option>
                        </>
                      ) : isAdminManager ? (
                        newUser.role === 'Admin Manager' ? (
                          <option value="Admin Manager">Admin Manager</option>
                        ) : (
                          <>
                            <option value="Editor">Editor</option>
                            <option value="Viewer">Viewer</option>
                          </>
                        )
                      ) : (
                        <>
                          <option value="Editor">Editor</option>
                          <option value="Viewer">Viewer</option>
                        </>
                      )}
                    </select>
                  </div>

                  <div className="ec-input-group">
                    <label className="ec-label">Scope</label>
                    <input
                      type="text"
                      value={newUser.scope}
                      onChange={e => setNewUser({ ...newUser, scope: e.target.value })}
                      placeholder={isAdminManager ? String(currentUser?.scope || '') : 'Region / Department'}
                      className="ec-input"
                      list="user-scope-options"
                      disabled={isAdminManager}
                    />
                    <datalist id="user-scope-options">
                      {knownScopes.map(s => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </div>

                  <div className="ec-input-group">
                    <label className="ec-label">Managed By</label>
                    <select
                      value={typeof newUser.managedById === 'number' ? String(newUser.managedById) : ''}
                      onChange={e => {
                        const v = e.target.value ? Number(e.target.value) : ''
                        setNewUser(prev => {
                          const mgr = typeof v === 'number' ? users.find(u => u.id === v) : null
                          const nextScope = String(prev.scope || '').trim() ? prev.scope : String(mgr?.scope || '')
                          return { ...prev, managedById: v, scope: nextScope }
                        })
                      }}
                      className="ec-input"
                      disabled={isAdminManager || !(newUser.role === 'Editor' || newUser.role === 'Viewer') || !isSuperManager}
                    >
                      <option value="">—</option>
                      {users
                        .filter(u => u.role === 'Admin Manager')
                        .map(u => (
                          <option key={u.id} value={String(u.id)}>
                            {u.name} {u.scope ? `(${u.scope})` : ''}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="ec-input-group">
                    <label className="ec-label">Status</label>
                    <select
                      value={newUser.status}
                      onChange={e => setNewUser({ ...newUser, status: e.target.value })}
                      className="ec-input"
                    >
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                      <option value="Suspended">Suspended</option>
                    </select>
                  </div>

                  <div className="ec-input-group">
                    <label className="ec-label">Last Login</label>
                    <input
                      type="text"
                      value={newUser.lastLogin}
                      onChange={e => setNewUser({ ...newUser, lastLogin: e.target.value })}
                      placeholder="Never"
                      className="ec-input"
                    />
                  </div>
                </div>

                <div className="ec-modal-footer">
                  <button
                    type="button"
                    className="ec-btn ec-btn-secondary"
                    onClick={() => setIsModalOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="ec-btn ec-btn-primary"
                  >
                    {editingId !== null ? 'Save Changes' : 'Add user'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteId !== null && (
        <div
          className="ec-modal-overlay ec-modal-active"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
        >
          <div
            className="ec-modal"
            style={{
              background: 'white',
              padding: '24px',
              borderRadius: '12px',
              width: '100%',
              maxWidth: '420px',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)'
            }}
          >
            <h2 style={{ margin: 0, marginBottom: '12px', fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
              Confirm Delete
            </h2>
            <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '20px' }}>
              Are you sure you want to delete this user? This action cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={() => setConfirmDeleteId(null)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: '1px solid #e2e8f0',
                  background: 'white',
                  cursor: 'pointer',
                  fontWeight: 500
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  background: '#ef4444',
                  color: 'white',
                  cursor: 'pointer',
                  fontWeight: 500
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {isAuditOpen && (
        <div
          className="ec-modal-overlay ec-modal-active"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
        >
          <div
            className="ec-modal"
            style={{
              background: 'white',
              padding: '24px',
              borderRadius: '12px',
              width: '100%',
              maxWidth: '540px',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
              maxHeight: '70vh',
              overflowY: 'auto'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>Audit Log</h2>
              <button
                onClick={() => setIsAuditOpen(false)}
                style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '18px', color: '#64748b' }}
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            {auditEntries.length === 0 ? (
              <p style={{ fontSize: '14px', color: '#64748b' }}>No activity recorded yet.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                    <th style={{ padding: '8px', textAlign: 'left', color: '#64748b' }}>Time</th>
                    <th style={{ padding: '8px', textAlign: 'left', color: '#64748b' }}>Actor</th>
                    <th style={{ padding: '8px', textAlign: 'left', color: '#64748b' }}>Action</th>
                    <th style={{ padding: '8px', textAlign: 'left', color: '#64748b' }}>Target</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.map(entry => (
                    <tr key={entry.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px', color: '#64748b' }}>{new Date(entry.at).toLocaleString()}</td>
                      <td style={{ padding: '8px', color: '#0f172a' }}>{entry.actorEmail || '—'}</td>
                      <td style={{ padding: '8px', color: '#0f172a' }}>{entry.action}</td>
                      <td style={{ padding: '8px', color: '#0f172a' }}>
                        {typeof entry.meta?.['targetEmail'] === 'string' ? String(entry.meta['targetEmail']) : entry.entityId || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
