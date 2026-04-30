export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value) && Number.isFinite(value)
}

export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

export function validateEC(ec: unknown): { ok: boolean; error?: string } {
  if (!isNumber(ec)) return { ok: false, error: 'EC must be a number' }
  if (ec < 0 || ec > 10) return { ok: false, error: 'EC must be between 0 and 10' }
  return { ok: true }
}

export function validatePH(ph: unknown): { ok: boolean; error?: string } {
  if (!isNumber(ph)) return { ok: false, error: 'pH must be a number' }
  if (ph < 0 || ph > 14) return { ok: false, error: 'pH must be between 0 and 14' }
  return { ok: true }
}

export function isPositiveNumber(n: unknown): { ok: boolean; error?: string } {
  if (!isNumber(n)) return { ok: false, error: 'Must be a number' }
  if (n <= 0) return { ok: false, error: 'Must be positive' }
  return { ok: true }
}

export function isNonNegativeNumber(n: unknown): { ok: boolean; error?: string } {
  if (!isNumber(n)) return { ok: false, error: 'Must be a number' }
  if (n < 0) return { ok: false, error: 'Must be ≥ 0' }
  return { ok: true }
}

export function isPositiveInteger(n: unknown): { ok: boolean; error?: string } {
  if (!isNumber(n)) return { ok: false, error: 'Must be a number' }
  if (!Number.isInteger(n) || n <= 0) return { ok: false, error: 'Must be a positive integer' }
  return { ok: true }
}

export function validateDateStr(value: unknown): { ok: boolean; error?: string } {
  if (!isString(value)) return { ok: false, error: 'Date must be text' }
  const r1 = /^(0[1-9]|[12][0-9]|3[01])\/(0[1-9]|1[0-2])\/\d{2}$/ // dd/mm/yy
  const r2 = /^(0[1-9]|[12][0-9]|3[01])-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2}$/i // dd-Mmm-yy
  if (!r1.test(value) && !r2.test(value)) return { ok: false, error: 'Invalid date format' }
  return { ok: true }
}

export function validateISODate(value: unknown): { ok: boolean; error?: string } {
  if (!isString(value)) return { ok: false, error: 'Date must be text' }
  const r = /^(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/
  if (!r.test(value)) return { ok: false, error: 'Invalid ISO date (YYYY-MM-DD)' }
  return { ok: true }
}

export function validateTimeStr(value: unknown): { ok: boolean; error?: string } {
  if (!isString(value)) return { ok: false, error: 'Time must be text' }
  const r = /^(0?[1-9]|1[0-2]):[0-5][0-9]\s?(AM|PM)$/i
  if (!r.test(value)) return { ok: false, error: 'Invalid time format' }
  return { ok: true }
}
