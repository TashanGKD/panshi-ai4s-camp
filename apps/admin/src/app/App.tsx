import { useEffect, useState } from 'react'
import type { ProfileResponse } from '@panshi/contracts'
import { AdminApiError, adminClient, type AdminClient } from '../api/admin-client'
import { resolvePublicWebBaseUrl } from '../api/admin-client'
import { LoginPage } from '../pages/LoginPage'
import { ContentEditor } from '../features/content/ContentEditor'
import { VersionHistory } from '../features/content/VersionHistory'
import '../styles/admin.css'

type State = { status: 'loading' } | { status: 'unauthenticated' } | { status: 'error' } | { status: 'authenticated', profile: ProfileResponse }

const configuredPublicWebBaseUrl = resolvePublicWebBaseUrl(import.meta.env.VITE_PUBLIC_WEB_BASE_URL, { production: import.meta.env.PROD })

const BasicContentTools = ({ client, publicWebBaseUrl }: { client: AdminClient, publicWebBaseUrl: string }) => {
  const [content, setContent] = useState<Awaited<ReturnType<AdminClient['getDraft']>>>()
  const [history, setHistory] = useState<Awaited<ReturnType<AdminClient['getHistory']>>>()
  const [error, setError] = useState(false)
  const refresh = async () => {
    const [nextContent, nextHistory] = await Promise.all([client.getDraft('basic'), client.getHistory('basic')])
    setContent(nextContent)
    setHistory(nextHistory)
  }
  useEffect(() => { void refresh().catch(() => setError(true)) }, [client])
  if (error) return <section><p role="alert">内容管理暂时无法加载</p></section>
  if (!content || !history) return <section><p role="status">正在加载内容草稿</p></section>
  return <div className="content-tools">
    <ContentEditor draft={content} publicWebBaseUrl={publicWebBaseUrl}
      onSave={async (payload, expectedRevision) => { setContent(await client.saveDraft('basic', payload, expectedRevision)) }}
      onPublish={async (expectedRevision) => { await client.publish('basic', expectedRevision); await refresh() }} />
    <VersionHistory publishedVersion={history.data.publishedVersion} versions={history.data.versions}
      onRollback={async (version) => { await client.rollback('basic', version); await refresh() }} />
  </div>
}

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

  return <main className="admin-shell"><header><div><p>磐石 AI4S 实训营</p><h1>磐石管理后台</h1></div>
    <button type="button" onClick={() => { void client.logout().then(() => setState({ status: 'unauthenticated' }), classify) }}>退出登录</button></header>
    <section className="welcome-card"><h2>欢迎，{state.profile.data.user.displayName}</h2><p>当前仅开放 Task 8 的基础内容发布工具。</p></section>
    <BasicContentTools client={client} publicWebBaseUrl={publicWebBaseUrl} />
  </main>
}
