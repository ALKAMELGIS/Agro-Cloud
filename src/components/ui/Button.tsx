import * as React from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
}

function cx(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(' ')
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', className, type, ...props },
  ref
) {
  const variantClass =
    variant === 'primary'
      ? 'ds-btn-primary'
      : variant === 'danger'
        ? 'ds-btn-danger'
        : variant === 'ghost'
          ? 'ds-btn-ghost'
          : ''

  return <button ref={ref} type={type ?? 'button'} className={cx('ds-btn', variantClass, className)} {...props} />
})

