import { useEffect, useState } from 'react'
import type { ProfileResponse } from '@panshi/contracts'
import { AdminApiError, adminClient, type AdminClient } from '../api/admin-client'
import { resolvePublicWebBaseUrl } from '../api/admin-client'
import { LoginPage } from '../pages/LoginPage'
import { AdminApp } from './AdminApp'
import '../styles/admin.css'

type State = { status: 'loading' } | { status: 'unauthenticated' } | { status: 'error' } | { status: 'authenticated', profile: ProfileResponse }

const configuredPublicWebBaseUrl = resolvePublicWebBaseUrl(import.meta.env.VITE_PUBLIC_WEB_BASE_URL, { production: import.meta.env.PROD })

export const App = ({ client = adminClient, publicWebBaseUrl = configuredPublicWebBaseUrl }: { client?: AdminClient, publicWebBaseUrl?: string }) => {
  const [state, setState] = useState<State>({ status: 'loading' })
  const classify = (error: unknown) => setState(error instanceof AdminApiError && [401, 403].includes(error.status)
    ? { status: 'unauthenticated' } : { status: 'error' })

  useEffect(() => {
    let active = true
    void client.getProfile().then((profile) => {
      if (active) setState({ status: 'authenticated', profile })
    }, (error) => { if (active) classify(error) })
    return () => { active = false }
  }, [client])

  if (state.status === 'loading') return <main className="state-shell"><p role="status">正在验证管理员身份</p></main>
  if (state.status === 'error') return <main className="state-shell"><p role="alert">管理后台加载失败，请稍后重试</p></main>
  if (state.status === 'unauthenticated') return <LoginPage onLogin={async (input) => {
    await client.login(input)
    const profile = await client.getProfile()
    setState({ status: 'authenticated', profile })
  }} />

  return <AdminApp client={client} publicWebBaseUrl={publicWebBaseUrl} displayName={state.profile.data.user.displayName} onLogout={async () => {
    try { await client.logout(); setState({ status: 'unauthenticated' }) } catch (error) { classify(error) }
  }} />
}
