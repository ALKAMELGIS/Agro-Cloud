import { readCurrentUser } from './auth'

export type AuditEntry = {
  id: string
  at: string
  entity: string
  entityId?: string
  action: string
  actorEmail?: string
  meta?: Record<string, unknown>
}

const AUDIT_KEY = 'audit_log_v1'

const normalizeEntry = (raw: unknown): AuditEntry | null => {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const id = String(obj.id ?? '').trim()
  const at = String(obj.at ?? '').trim()
  const entity = String(obj.entity ?? '').trim()
  const action = String(obj.action ?? '').trim()
  if (!id || !at || !entity || !action) return null
  const entityId = typeof obj.entityId === 'string' && obj.entityId.trim() ? obj.entityId.trim() : undefined
  const actorEmail = typeof obj.actorEmail === 'string' && obj.actorEmail.trim() ? obj.actorEmail.trim() : undefined
  const meta = obj.meta && typeof obj.meta === 'object' ? (obj.meta as Record<string, unknown>) : undefined
  return { id, at, entity, action, entityId, actorEmail, meta }
}

export const readAuditLog = (): AuditEntry[] => {
  try {
    const raw = localStorage.getItem(AUDIT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const entries = parsed.map(normalizeEntry).filter(Boolean) as AuditEntry[]
    return entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  } catch {
    return []
  }
}

export const appendAuditLog = (
  entry: Omit<AuditEntry, 'id' | 'at'> & { id?: string; at?: string }
): AuditEntry => {
  const nowIso = new Date().toISOString()
  const id =
    typeof entry.id === 'string' && entry.id.trim()
      ? entry.id.trim()
      : typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`

  const user = readCurrentUser()
  const actorEmail =
    typeof entry.actorEmail === 'string' && entry.actorEmail.trim()
      ? entry.actorEmail.trim()
      : user?.email
        ? String(user.email).trim()
        : undefined

  const normalized: AuditEntry = {
    id,
    at: typeof entry.at === 'string' && entry.at.trim() ? entry.at.trim() : nowIso,
    entity: String(entry.entity).trim(),
    entityId: typeof entry.entityId === 'string' && entry.entityId.trim() ? entry.entityId.trim() : undefined,
    action: String(entry.action).trim(),
    actorEmail,
    meta: entry.meta && typeof entry.meta === 'object' ? entry.meta : undefined,
  }

  const current = readAuditLog()
  const next = [normalized, ...current].slice(0, 2000)
  try {
    localStorage.setItem(AUDIT_KEY, JSON.stringify(next))
  } catch {
  }
  return normalized
}

