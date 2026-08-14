import type { AdminContentHistoryResponse } from '@panshi/contracts'

export function VersionHistory({ busy, publishedVersion, versions, onRollback }: {
  busy: boolean
  publishedVersion: number | null
  versions: AdminContentHistoryResponse['data']['versions']
  onRollback: (version: number) => void
}) {
  return <section className="version-history" aria-labelledby="version-history-title">
    <h2 id="version-history-title">版本历史</h2>
    {versions.length === 0 ? <p>尚无已发布版本</p> : <ol>{versions.map((version) => <li key={version.version}>
      <div><strong>版本 {version.version}{version.version === publishedVersion ? '（当前）' : ''}</strong>
        <time dateTime={version.createdAt}>{new Date(version.createdAt).toLocaleString('zh-CN')}</time></div>
      {version.version === publishedVersion ? null : <button type="button" disabled={busy} onClick={() => onRollback(version.version)}>
        回退到版本 {version.version}
      </button>}
    </li>)}</ol>}
  </section>
}
