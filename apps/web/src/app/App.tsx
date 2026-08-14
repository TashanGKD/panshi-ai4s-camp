import '@panshi/ui/tokens.css'
import { useEffect, useState } from 'react'
import { Route, Routes, useParams } from 'react-router-dom'
import { ContentModuleKeySchema, type PublicSiteResponse } from '@panshi/contracts'
import { getPublicSite } from '../api/public-client'
import { ContactPage } from '../pages/ContactPage'
import { HomePage } from '../pages/HomePage'
import { ResourcesPage } from '../pages/ResourcesPage'
import { SchedulePage } from '../pages/SchedulePage'
import { TravelPage } from '../pages/TravelPage'
import { PreviewPage } from '../pages/PreviewPage'
import { RegisterPage } from '../pages/RegisterPage'
import { LoginPage } from '../pages/LoginPage'
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage'
import { RegistrationPage } from '../pages/RegistrationPage'
import { AccountPage } from '../pages/AccountPage'
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

const PreviewRoute = ({ site }: { site: PublicSiteResponse['data'] }) => {
  const parsed = ContentModuleKeySchema.safeParse(useParams().module)
  return parsed.success
    ? <PreviewPage site={site} moduleKey={parsed.data} />
    : <main className="event-container public-state"><p role="alert">不支持的内容预览模块</p></main>
}

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
    <Route path="/resources" element={<PublicShell site={site}><ResourcesPage apiReady={state.status === 'ready'} /></PublicShell>} />
    <Route path="/register" element={<PublicShell site={site}><RegisterPage /></PublicShell>} />
    <Route path="/login" element={<PublicShell site={site}><LoginPage /></PublicShell>} />
    <Route path="/forgot-password" element={<PublicShell site={site}><ForgotPasswordPage /></PublicShell>} />
    <Route path="/application" element={<PublicShell site={site}><RegistrationPage /></PublicShell>} />
    <Route path="/account" element={<PublicShell site={site}><AccountPage /></PublicShell>} />
    <Route path="/preview/:module" element={<PreviewRoute site={site} />} />
  </Routes>
}
