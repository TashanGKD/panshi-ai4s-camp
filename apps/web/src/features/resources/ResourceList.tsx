import { useEffect, useState } from 'react'
import type { PublicResource } from '@panshi/contracts'
import { downloadResource, getResources } from '../../api/public-client'

export function ResourceList({ load = getResources, download = downloadResource }: { load?: typeof getResources, download?: typeof downloadResource }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'ready', items: PublicResource[] }>({ status: 'loading' })
  const [downloadError, setDownloadError] = useState('')
  useEffect(() => { let active = true; void load().then(({ data }) => { if (active) setState({ status: 'ready', items: data.resources }) }, () => { if (active) setState({ status: 'error' }) }); return () => { active = false } }, [load])
  if (state.status === 'loading') return <p role="status">正在加载相关资料</p>
  if (state.status === 'error') return <p role="alert">相关资料暂时无法加载，请重新登录或稍后重试。</p>
  if (state.items.length === 0) return <p>暂无当前账号可访问的资料。登录后或录取后可能开放更多资料。</p>
  const startDownload = async (item: PublicResource) => {
    setDownloadError('')
    try {
      const file = await download(item.downloadUrl)
      const url = URL.createObjectURL(file.blob); const link = document.createElement('a'); link.href = url; link.download = file.filename; link.click(); URL.revokeObjectURL(url)
    } catch { setDownloadError('资料下载失败，登录状态可能已过期，或该资料已下线。请重新登录后再试。') }
  }
  return <>{downloadError ? <p role="alert">{downloadError}</p> : null}<ul className="resource-list">{state.items.map((item) => <li key={item.id}>
    <div><strong>{item.title}</strong>{item.description ? <p>{item.description}</p> : null}</div>
    <a href={item.downloadUrl} onClick={(event) => { event.preventDefault(); void startDownload(item) }}>下载</a>
  </li>)}</ul></>
}
