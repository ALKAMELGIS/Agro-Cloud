import * as React from 'react'

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement>

function cx(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(' ')
}

export function Badge({ className, ...props }: BadgeProps) {
  return <span className={cx('ds-badge', className)} {...props} />
}

