import { useEffect, useMemo, useRef, useState } from 'react'

type Props = {
  layerId: string
  fields: string[]
  hiddenFields: Set<string>
  onChangeHiddenFields: (next: Set<string>) => void
}

const storageKeyForLayer = (layerId: string) => `gis:layer-table:hidden-fields:${layerId}`

const readHiddenFields = (layerId: string, fields: string[]) => {
  const key = storageKeyForLayer(layerId)
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return new Set<string>()
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : []
    const fieldSet = new Set(fields.map(f => String(f)))
    const next = new Set<string>()
    for (const v of list) {
      const s = String(v)
      if (fieldSet.has(s)) next.add(s)
    }
    return next
  } catch {
    return new Set<string>()
  }
}

const writeHiddenFields = (layerId: string, hidden: Set<string>) => {
  const key = storageKeyForLayer(layerId)
  try {
    const list = Array.from(hidden.values())
    window.localStorage.setItem(key, JSON.stringify(list))
  } catch {}
}

export function FieldVisibilityControl({ layerId, fields, hiddenFields, onChangeHiddenFields }: Props) {
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<null | { top: number; left: number }>(null)

  const fieldsSig = useMemo(() => fields.join('\u0000'), [fields])

  useEffect(() => {
    const next = readHiddenFields(layerId, fields)
    onChangeHiddenFields(next)
  }, [layerId, fieldsSig])

  useEffect(() => {
    writeHiddenFields(layerId, hiddenFields)
  }, [layerId, hiddenFields, fieldsSig])

  useEffect(() => {
    if (!open) return
    const btn = btnRef.current
    if (btn) {
      const r = btn.getBoundingClientRect()
      const desiredLeft = r.left
      const maxLeft = Math.max(8, window.innerWidth - 320 - 8)
      const left = Math.max(8, Math.min(maxLeft, desiredLeft))
      const top = Math.max(8, Math.min(window.innerHeight - 120, r.bottom + 8))
      setPos({ left, top })
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof Node)) return
      const pop = popRef.current
      const btnEl = btnRef.current
      if (btnEl && btnEl.contains(target)) return
      if (pop && pop.contains(target)) return
      setOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => {
      const first = popRef.current?.querySelector<HTMLElement>('button')
      first?.focus?.()
    }, 0)
    return () => window.clearTimeout(id)
  }, [open])

  const toggleField = (field: string) => {
    const next = new Set(hiddenFields)
    if (next.has(field)) next.delete(field)
    else next.add(field)
    onChangeHiddenFields(next)
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="gis-fieldvis-btn"
        aria-label="Field visibility"
        aria-haspopup="dialog"
        aria-expanded={open ? 'true' : 'false'}
        onClick={() => setOpen(v => !v)}
      >
        <i className="fa-solid fa-eye" aria-hidden="true" />
        <span>Field visibility</span>
      </button>
      {open && pos ? (
        <div
          ref={popRef}
          className="gis-fieldvis-popover"
          role="dialog"
          aria-label="Field visibility"
          style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
        >
          <div className="gis-fieldvis-title">Field visibility</div>
          <div className="gis-fieldvis-list" role="list">
            {fields.map((f) => {
              const visible = !hiddenFields.has(f)
              return (
                <div className="gis-fieldvis-row" role="listitem" key={f}>
                  <span className="gis-fieldvis-name" title={f}>
                    {f}
                  </span>
                  <button
                    type="button"
                    className={visible ? 'gis-fieldvis-toggle' : 'gis-fieldvis-toggle off'}
                    aria-label={visible ? `Hide field ${f}` : `Show field ${f}`}
                    aria-pressed={visible ? 'true' : 'false'}
                    onClick={() => toggleField(f)}
                  >
                    <i className={`fa-solid ${visible ? 'fa-eye' : 'fa-eye-slash'}`} aria-hidden="true" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </>
  )
}

export const __test__ = {
  storageKeyForLayer,
  readHiddenFields,
  writeHiddenFields,
}

