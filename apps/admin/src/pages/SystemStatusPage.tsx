import { useCallback, useEffect, useRef, useState } from 'react'
import type { AdminClient, AdminSystemHealthResponse } from '../api/admin-client'

const formatCapacity = (bytes: number | null) => bytes === null ? '不可用' : `${Math.floor(bytes / 1_048_576)} MiB`
const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN')

export function SystemStatusPage({ client }: { client: AdminClient }) {
  const sequence = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const [health, setHealth] = useState<AdminSystemHealthResponse>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    const current = ++sequence.current
    controller.current?.abort()
    const nextController = new AbortController()
    controller.current = nextController
    setLoading(true)
    setError(false)
    try {
      const result = await client.getSystemHealth(nextController.signal)
      if (current === sequence.current) setHealth(result)
    } catch {
      if (current === sequence.current) setError(true)
    } finally {
      if (current === sequence.current) setLoading(false)
    }
  }, [client])

  useEffect(() => {
    void load()
    return () => {
      sequence.current++
      controller.current?.abort()
    }
  }, [load])

  return <section className="page-section"><div className="page-heading"><div><p>基础监测</p><h1>系统状态</h1></div><button type="button" className="button-secondary" onClick={() => { void load() }}>手动刷新</button></div>
    {loading && !health ? <p role="status">正在检查系统状态</p> : null}
    {error && !health ? <div className="panel"><p role="alert">系统状态暂时无法加载</p><button type="button" onClick={() => { void load() }}>重试</button></div> : null}
    {health ? <>
      {error ? <p role="alert">刷新失败，当前显示上一次检查结果</p> : null}
      <div className={`system-status-banner ${health.data.status}`}><strong>{health.data.status === 'healthy' ? '运行正常' : '需要关注'}</strong><span>检查时间 <time dateTime={health.data.checkedAt}>{formatTime(health.data.checkedAt)}</time></span></div>
      <div className="system-status-grid">
        <article className="panel"><h2>数据库</h2><strong>{health.data.database.connected ? '数据库连接正常' : '数据库连接异常'}</strong></article>
        <article className="panel"><h2>上传存储</h2><strong>{health.data.uploads.writable ? '上传目录可写' : '上传目录不可写'}</strong><p>可用空间：{formatCapacity(health.data.uploads.freeBytes)}</p></article>
        <article className="panel"><h2>备份</h2><strong>{health.data.backup.available ? '最近备份成功' : '尚无成功备份'}</strong>{health.data.backup.lastSuccessfulAt ? <p><time dateTime={health.data.backup.lastSuccessfulAt}>{formatTime(health.data.backup.lastSuccessfulAt)}</time></p> : null}</article>
        <article className="panel"><h2>应用版本</h2><strong>{health.data.version}</strong></article>
      </div>
    </> : null}
  </section>
}
