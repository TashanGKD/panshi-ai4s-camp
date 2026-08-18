import { useEffect, useState } from 'react'
import type { TravelContent } from '@panshi/contracts'
import { getPublicTravel, PublicContentNotFoundError } from '../api/public-client'
import { RichText } from '../components/RichText'

type State = { status: 'loading' | 'empty' | 'error' } | { status: 'ready', data: TravelContent }

export function TravelPage() {
  const [state, setState] = useState<State>({ status: 'loading' })
  useEffect(() => {
    let active = true
    void getPublicTravel().then(
      (data) => { if (active) setState(data.sections.length === 0 ? { status: 'empty' } : { status: 'ready', data }) },
      (error: unknown) => { if (active) setState({ status: error instanceof PublicContentNotFoundError ? 'empty' : 'error' }) },
    )
    return () => { active = false }
  }, [])

  return <section className="public-page__section"><h2>交通住宿</h2>
    {state.status === 'loading' ? <p role="status">正在加载交通与住宿信息</p> : null}
    {state.status === 'empty' ? <p>交通与住宿信息尚未发布</p> : null}
    {state.status === 'error' ? <p role="alert">交通与住宿信息暂时无法加载</p> : null}
    {state.status === 'ready' ? <TravelContentView travel={state.data} /> : null}
  </section>
}

export function TravelContentView({ travel }: { travel: TravelContent }) {
  return <div className="travel-sections">{travel.sections.map((section) => <article className="travel-section" key={section.title}>
    <h3>{section.title}</h3>
    {section.image ? <figure className="travel-map">
      <img src={section.image.src} alt={section.image.alt} />
      {section.image.caption ? <figcaption>{section.image.caption}</figcaption> : null}
    </figure> : null}
    <RichText as="div" className="travel-section__body" html={section.body} />
  </article>)}</div>
}
