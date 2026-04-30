import * as React from 'react'

export type ModalProps = {
  isOpen: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
  actions?: React.ReactNode
}

export function Modal({ isOpen, title, onClose, children, actions }: ModalProps) {
  const modalRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab') {
        const root = modalRef.current
        if (!root) return
        const focusable = Array.from(
          root.querySelectorAll<HTMLElement>(
            'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1 && el.offsetParent !== null)
        if (!focusable.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        const active = document.activeElement as HTMLElement | null
        if (e.shiftKey) {
          if (!active || active === first) {
            e.preventDefault()
            last.focus()
          }
        } else {
          if (active === last) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    }
    window.addEventListener('keydown', handler)
    const t = window.setTimeout(() => {
      modalRef.current?.focus()
    }, 0)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', handler)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null
  const titleId = 'ds-modal-title'

  return (
    <div className="ds-modal-overlay" role="presentation" onClick={() => onClose()}>
      <div
        ref={modalRef}
        className="ds-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ds-modal-header">
          <div className="ds-modal-title" id={titleId}>
            {title}
          </div>
          <button className="ds-btn ds-btn-ghost" type="button" onClick={() => onClose()} aria-label="Close dialog">
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div className="ds-modal-body">{children}</div>
        {actions ? <div className="ds-modal-actions">{actions}</div> : null}
      </div>
    </div>
  )
}
