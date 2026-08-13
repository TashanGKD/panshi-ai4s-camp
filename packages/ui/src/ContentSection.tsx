import type { ReactNode } from 'react'

export function ContentSection({ children, id, title }: { children: ReactNode; id?: string; title: string }) {
  return <section className="content-section" id={id}><h2 className="content-section__title">{title}</h2><div className="content-section__body">{children}</div></section>
}
