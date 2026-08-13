import { useEffect, useState } from 'react'
import { getPublicSite } from '../api/public-client'

type State = 'loading' | 'empty' | 'error'

export function ResourcesPage() {
  const [state, setState] = useState<State>('loading')

  useEffect(() => {
    let active = true
    void getPublicSite().then(
      () => { if (active) setState('empty') },
      () => { if (active) setState('error') },
    )
    return () => { active = false }
  }, [])

  return <section className="public-page__section"><h2>相关资料</h2>
    {state === 'loading' ? <p role="status">正在检查相关资料</p> : null}
    {state === 'empty' ? <p>相关资料尚未发布</p> : null}
    {state === 'error' ? <p role="alert">相关资料暂时无法加载</p> : null}
  </section>
}
