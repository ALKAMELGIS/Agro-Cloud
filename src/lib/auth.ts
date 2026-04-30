export type Role = 'Admin' | 'Manager' | 'Admin Manager' | 'Editor' | 'Viewer'

export type CurrentUser = {
  id: number
  name: string
  email: string
  role: Role | string
  scope?: string
  managedById?: number
}

export const normalizeEmail = (value: unknown): string => {
  let v = String(value ?? '')
  try {
    v = v.normalize('NFKC')
  } catch {
  }
  return v.replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase()
}

export const normalizeRole = (value: unknown): Role => {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return 'Viewer'
  if (raw === 'admin') return 'Admin'
  if (raw === 'manager') return 'Manager'
  if (raw === 'admin manager' || raw === 'admin_manager' || raw === 'admin-manager') return 'Admin Manager'
  if (raw === 'editor') return 'Editor'
  if (raw === 'viewer') return 'Viewer'
  if (raw.includes('admin') && raw.includes('manager')) return 'Admin Manager'
  return 'Viewer'
}

export const readCurrentUser = (): CurrentUser | null => {
  try {
    const raw = localStorage.getItem('currentUser')
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const obj = parsed as Record<string, unknown>
    const id = typeof obj.id === 'number' ? obj.id : Number(obj.id ?? 0)
    const email = String(obj.email ?? '').trim()
    if (!email) return null
    return {
      id: Number.isFinite(id) && id > 0 ? id : Date.now(),
      name: String(obj.name ?? email),
      email,
      role: typeof obj.role === 'string' ? obj.role : normalizeRole(obj.role),
      scope: typeof obj.scope === 'string' && obj.scope.trim() ? obj.scope.trim() : undefined,
      managedById: typeof obj.managedById === 'number' ? obj.managedById : undefined,
    }
  } catch {
    return null
  }
}

export const startSession = (user: Partial<CurrentUser> | null): void => {
  try {
    if (!user) {
      localStorage.removeItem('currentUser')
    } else {
      const existing = readCurrentUser()
      const merged: CurrentUser = {
        id: typeof user.id === 'number' ? user.id : existing?.id ?? Date.now(),
        name: typeof user.name === 'string' && user.name.trim() ? user.name.trim() : existing?.name ?? 'User',
        email: typeof user.email === 'string' ? user.email.trim() : existing?.email ?? '',
        role: typeof user.role === 'string' ? user.role : existing?.role ?? 'Viewer',
        scope: typeof user.scope === 'string' && user.scope.trim() ? user.scope.trim() : existing?.scope,
        managedById: typeof user.managedById === 'number' ? user.managedById : existing?.managedById,
      }
      localStorage.setItem('currentUser', JSON.stringify(merged))
    }
    window.dispatchEvent(new Event('storage'))
  } catch {
  }
}

const roleAllows = (role: Role, permission: string): boolean => {
  if (role === 'Admin') return true
  if (permission === 'dataSource.update') return role === 'Manager'
  if (permission === 'admin.users.manage') return role === 'Manager' || role === 'Admin Manager'
  return false
}

export const hasPermission = (permission: string, roleValue: unknown): boolean => {
  const role = normalizeRole(roleValue)
  return roleAllows(role, permission)
}

export const canManageDataSourceSettings = (): boolean => {
  const user = readCurrentUser()
  const role = normalizeRole(user?.role)
  return role === 'Admin' || role === 'Manager'
}
