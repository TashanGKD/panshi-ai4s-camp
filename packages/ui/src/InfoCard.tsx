import type { ReactNode } from 'react'

interface InfoCardProps {
  as?: 'article' | 'section'
  children: ReactNode
  headingLevel?: 2 | 3
  title: string
  variant?: 'compact' | 'default'
}

export function InfoCard({ as = 'section', children, headingLevel = 2, title, variant = 'default' }: InfoCardProps) {
  const className = `info-card${variant === 'compact' ? ' info-card--compact' : ''}`
  const heading = headingLevel === 3 ? <h3 className="info-card__title">{title}</h3> : <h2 className="info-card__title">{title}</h2>
  return as === 'article' ? <article className={className}>{heading}{children}</article> : <section className={className}>{heading}{children}</section>
}
