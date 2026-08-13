import '@panshi/ui/tokens.css'
import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import type { PublicSiteResponse } from '@panshi/contracts'
import { getPublicSite } from '../api/public-client'
import { ContactPage } from '../pages/ContactPage'
import { HomePage } from '../pages/HomePage'
import { ResourcesPage } from '../pages/ResourcesPage'
import { SchedulePage } from '../pages/SchedulePage'
import { TravelPage } from '../pages/TravelPage'
import { PublicShell } from './PublicShell'
import { SkipLink } from './SkipLink'
import '../styles/public.css'

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready', site: PublicSiteResponse['data'] }

const LoadingOrError = ({ error = false }: { error?: boolean }) => <div className="public-shell">
  <SkipLink />
  <main id="main-content" className="event-container public-state" tabIndex={-1}>
    {error ? <p role="alert">活动信息暂时无法加载，请稍后重试。</p> : <p role="status">正在加载活动信息</p>}
  </main>
</div>

const PlaceholderPage = ({ title }: { title: string }) => <section className="public-page__section"><h2>{title}</h2><p>本页面尚未开放。</p></section>

export function App() {
  const [state, setState] = useState<State>({ status: 'loading' })
  useEffect(() => {
    let active = true
    void getPublicSite().then(
      ({ data }) => { if (active) setState({ status: 'ready', site: data }) },
      () => { if (active) setState({ status: 'error' }) },
    )
    return () => { active = false }
  }, [])

  if (state.status === 'loading') return <LoadingOrError />
  if (state.status === 'error') return <LoadingOrError error />

  const site = state.site
  return <Routes>
    <Route path="/" element={<PublicShell site={site} sidebar><HomePage basic={site.basic} /></PublicShell>} />
    <Route path="/schedule" element={<PublicShell site={site}><SchedulePage /></PublicShell>} />
    <Route path="/travel" element={<PublicShell site={site}><TravelPage /></PublicShell>} />
    <Route path="/contact" element={<PublicShell site={site}><ContactPage contacts={site.contacts} /></PublicShell>} />
    <Route path="/resources" element={<PublicShell site={site}><ResourcesPage /></PublicShell>} />
    <Route path="/register" element={<PublicShell site={site}><PlaceholderPage title="在线注册" /></PublicShell>} />
    <Route path="/account" element={<PublicShell site={site}><PlaceholderPage title="个人中心" /></PublicShell>} />
  </Routes>
}
