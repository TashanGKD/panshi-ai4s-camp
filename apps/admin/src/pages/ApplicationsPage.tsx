import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AdminApplicationListItem, AdminClient } from '../api/admin-client'
import { BulkStatusDialog } from '../features/applications/BulkStatusDialog'

const statuses = ['', 'submitted', 'reviewing', 'needs_supplement', 'admitted', 'waitlisted', 'rejected']
const bulkStatuses = ['reviewing', 'admitted', 'waitlisted', 'rejected']
type BulkResult = { applicationId: string, success: boolean, status?: string, code?: string, message?: string }
type BulkReport = { targetStatus: string, results: BulkResult[] }

export function ApplicationsPage({ client }: { client: AdminClient }) {
  const [filters, setFilters] = useState({ status: '', search: '', organization: '', identityType: '', educationStage: '', submittedFrom: '', submittedTo: '', page: 1 })
  const [items, setItems] = useState<AdminApplicationListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkTarget, setBulkTarget] = useState('')
  const [bulkIds, setBulkIds] = useState<string[]>([])
  const [showBulk, setShowBulk] = useState(false)
  const [pending, setPending] = useState(false)
  const [bulkReport, setBulkReport] = useState<BulkReport | null>(null)
  const generation = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const query = useMemo(() => {
    const value = new URLSearchParams({ page: String(filters.page), pageSize: '20', sort: 'submittedAt_desc' })
    for (const key of ['status', 'search', 'organization', 'identityType', 'educationStage', 'submittedFrom', 'submittedTo'] as const) if (filters[key]) value.set(key, filters[key])
    return value
  }, [filters])
  const queryKey = query.toString()

  const load = useCallback(async (clearSelection: boolean) => {
    const currentGeneration = ++generation.current
    controller.current?.abort()
    const currentController = new AbortController()
    controller.current = currentController
    setLoading(true)
    setError('')
    try {
      const response = await client.listApplications(new URLSearchParams(queryKey), currentController.signal)
      if (generation.current !== currentGeneration) return
      setItems(response.data.items)
      setTotal(response.data.total)
      if (clearSelection) setSelected(new Set())
    } catch (caught) {
      if (generation.current !== currentGeneration || currentController.signal.aborted) return
      setError(caught instanceof Error ? caught.message : '加载失败')
    } finally {
      if (generation.current === currentGeneration) setLoading(false)
    }
  }, [client, queryKey])

  useEffect(() => {
    void load(true)
    return () => controller.current?.abort()
  }, [load])

  const update = (key: keyof typeof filters, value: string | number) => setFilters((current) => ({ ...current, [key]: value, ...(key === 'page' ? {} : { page: 1 }) }))
  const exportCsv = async () => {
    try {
      const blob = await client.exportApplications(new URLSearchParams(queryKey))
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = '实训营报名名单.csv'
      link.click()
      URL.revokeObjectURL(url)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '导出失败') }
  }
  const bulk = async () => {
    const attemptedIds = [...bulkIds]
    setPending(true)
    setError('')
    try {
      const response = await client.bulkTransitionApplications({ applicationIds: attemptedIds, targetStatus: bulkTarget })
      const report = { targetStatus: bulkTarget, results: response.data.results }
      const failed = report.results.filter((entry) => !entry.success).map((entry) => entry.applicationId)
      setBulkReport(report)
      setShowBulk(false)
      await load(false)
      setSelected(new Set(failed))
    } catch (caught) { setError(caught instanceof Error ? caught.message : '批量操作失败') } finally { setPending(false) }
  }
  const openBulk = (ids: string[], targetStatus = bulkTarget) => {
    setBulkIds([...new Set(ids)])
    setBulkTarget(targetStatus)
    setShowBulk(true)
  }
  const failedIds = bulkReport?.results.filter((entry) => !entry.success).map((entry) => entry.applicationId) ?? []

  return <section>
    <header className="admin-page-header"><div><h1>报名审核</h1><p>共 {total} 份符合当前筛选条件的报名</p></div><button type="button" onClick={() => void exportCsv()}>导出当前筛选</button></header>
    <div className="application-filters"><label>状态<select value={filters.status} onChange={(event) => update('status', event.target.value)}>{statuses.map((status) => <option key={status} value={status}>{status || '全部'}</option>)}</select></label><label>搜索<input value={filters.search} maxLength={100} placeholder="姓名、手机号或单位" onChange={(event) => update('search', event.target.value)} /></label><label>单位<input value={filters.organization} maxLength={200} onChange={(event) => update('organization', event.target.value)} /></label><label>身份<input value={filters.identityType} maxLength={100} onChange={(event) => update('identityType', event.target.value)} /></label><label>学历<input value={filters.educationStage} maxLength={100} onChange={(event) => update('educationStage', event.target.value)} /></label><label>提交起始<input type="datetime-local" onChange={(event) => update('submittedFrom', event.target.value ? new Date(event.target.value).toISOString() : '')} /></label><label>提交截止<input type="datetime-local" onChange={(event) => update('submittedTo', event.target.value ? new Date(event.target.value).toISOString() : '')} /></label></div>
    {error ? <p role="alert">{error}</p> : null}{loading ? <p role="status">正在加载报名</p> : items.length === 0 ? <p>暂无符合条件的报名。</p> : <table><thead><tr><th>选择</th><th>姓名</th><th>单位</th><th>身份/学历</th><th>状态</th><th>提交时间</th><th>操作</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><input aria-label={`选择 ${item.name}`} type="checkbox" checked={selected.has(item.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next })} /></td><td>{item.name}</td><td>{item.organization}</td><td>{item.identityType} / {item.educationStage}</td><td>{item.status}</td><td>{item.submittedAt ? new Date(item.submittedAt).toLocaleString('zh-CN') : '—'}</td><td><Link to={`/applications/${item.id}`}>查看审核</Link></td></tr>)}</tbody></table>}
    <div className="admin-actions"><select aria-label="批量目标状态" value={bulkTarget} onChange={(event) => setBulkTarget(event.target.value)}><option value="">选择目标状态</option>{bulkStatuses.map((status) => <option key={status}>{status}</option>)}</select><button type="button" disabled={!bulkTarget || selected.size === 0} onClick={() => openBulk([...selected])}>批量调整（{selected.size}）</button><button type="button" disabled={filters.page <= 1} onClick={() => update('page', filters.page - 1)}>上一页</button><button type="button" disabled={filters.page * 20 >= total} onClick={() => update('page', filters.page + 1)}>下一页</button></div>
    {bulkReport ? <section role="region" aria-label="批量处理结果"><h2>批量处理结果</h2><p>目标状态：{bulkReport.targetStatus}；成功 {bulkReport.results.filter((entry) => entry.success).length} 份，失败 {failedIds.length} 份。</p><table><thead><tr><th>报名编号</th><th>结果</th><th>代码</th><th>说明</th></tr></thead><tbody>{bulkReport.results.map((entry) => <tr key={entry.applicationId}><td>{entry.applicationId}</td><td>{entry.success ? '成功' : '失败'}</td><td>{entry.code ?? '—'}</td><td>{entry.message ?? entry.status ?? '—'}</td></tr>)}</tbody></table>{failedIds.length ? <div className="admin-actions"><button type="button" onClick={() => setSelected(new Set(failedIds))}>重新选择失败项（{failedIds.length}）</button><button type="button" onClick={() => openBulk(failedIds, bulkReport.targetStatus)}>重试失败项（{failedIds.length}）</button></div> : null}</section> : null}
    {showBulk ? <BulkStatusDialog count={bulkIds.length} targetStatus={bulkTarget} pending={pending} onCancel={() => setShowBulk(false)} onConfirm={bulk} /> : null}
  </section>
}
