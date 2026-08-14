import { useEffect, useState } from 'react'
import type { ProfileResponse } from '@panshi/contracts'
import { AdminApiError, adminClient, type AdminClient } from '../api/admin-client'
import { LoginPage } from '../pages/LoginPage'
import '../styles/admin.css'

type State = { status: 'loading' } | { status: 'unauthenticated' } | { status: 'error' } | { status: 'authenticated', profile: ProfileResponse }

export const App = ({ client = adminClient }: { client?: AdminClient }) => {
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

  return <main className="admin-shell"><header><div><p>磐石 AI4S 实训营</p><h1>磐石管理后台</h1></div>
    <button type="button" onClick={() => { void client.logout().then(() => setState({ status: 'unauthenticated' }), classify) }}>退出登录</button></header>
    <section><h2>欢迎，{state.profile.data.user.displayName}</h2><p>管理功能将在后续任务中接入。</p></section></main>
}
