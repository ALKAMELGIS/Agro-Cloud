import * as React from 'react'

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>

function cx(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(' ')
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, ...props }, ref) {
  return <select ref={ref} className={cx('ds-input', className)} {...props} />
})

