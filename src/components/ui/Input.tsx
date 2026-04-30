import * as React from 'react'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

function cx(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(' ')
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cx('ds-input', className)} {...props} />
})

