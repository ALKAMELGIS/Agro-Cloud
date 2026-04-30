import * as React from 'react'

export type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  padded?: boolean
}

function cx(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(' ')
}

export function Card({ padded = true, className, ...props }: CardProps) {
  return <div className={cx('ds-card', padded && 'ds-card-pad', className)} {...props} />
}

