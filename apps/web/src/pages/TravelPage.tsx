import { useEffect, useState } from 'react'
import type { TravelContent } from '@panshi/contracts'
import { getPublicTravel, PublicContentNotFoundError } from '../api/public-client'

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

  return <section className="public-page__section"><h2>住宿交通</h2>
    {state.status === 'loading' ? <p role="status">正在加载住宿与交通信息</p> : null}
    {state.status === 'empty' ? <p>住宿与交通信息尚未发布</p> : null}
    {state.status === 'error' ? <p role="alert">住宿与交通信息暂时无法加载</p> : null}
    {state.status === 'ready' ? <TravelContentView travel={state.data} /> : null}
  </section>
}

export function TravelContentView({ travel }: { travel: TravelContent }) {
  return <>{travel.sections.map((section) => <article key={section.title}><h3>{section.title}</h3><p>{section.body}</p></article>)}</>
}
