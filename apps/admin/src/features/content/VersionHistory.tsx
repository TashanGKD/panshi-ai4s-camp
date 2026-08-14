import type { AdminContentHistoryResponse } from '@panshi/contracts'
import { useState } from 'react'

export function VersionHistory({ publishedVersion, versions, onRollback }: {
  publishedVersion: number | null
  versions: AdminContentHistoryResponse['data']['versions']
  onRollback: (version: number) => Promise<void>
}) {
  const [pendingVersion, setPendingVersion] = useState<number | null>(null)
  const [rollbackFailed, setRollbackFailed] = useState(false)

  const rollback = async (version: number) => {
    if (pendingVersion !== null) return
    setPendingVersion(version)
    setRollbackFailed(false)
    try {
      await onRollback(version)
    } catch {
      setRollbackFailed(true)
    } finally {
      setPendingVersion(null)
    }
  }

  return <section className="version-history" aria-labelledby="version-history-title">
    <h2 id="version-history-title">版本历史</h2>
    {pendingVersion === null ? null : <p role="status">正在回退到版本 {pendingVersion}</p>}
    {rollbackFailed ? <p role="alert">版本回退失败，请重试</p> : null}
    {versions.length === 0 ? <p>尚无已发布版本</p> : <ol>{versions.map((version) => <li key={version.version}>
      <div><strong>版本 {version.version}{version.version === publishedVersion ? '（当前）' : ''}</strong>
        <time dateTime={version.createdAt}>{new Date(version.createdAt).toLocaleString('zh-CN')}</time></div>
      {version.version === publishedVersion ? null : <button type="button" disabled={pendingVersion !== null} onClick={() => { void rollback(version.version) }}>
        回退到版本 {version.version}
      </button>}
    </li>)}</ol>}
  </section>
}
