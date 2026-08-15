import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { AdminClient, AuditLogItem } from '../api/admin-client'

const visibleMetadataKeys = new Set(['result', 'revision', 'version', 'sourceVersion', 'count', 'successCount', 'failureCount', 'requestedCount', 'answerCount', 'attachmentCount', 'retiredAnswerCount', 'questionCount', 'activeQuestionCount', 'activeAttachmentCount', 'fromStatus', 'toStatus', 'targetStatus', 'accessScope', 'sortOrder', 'authenticationMethod', 'revokedSessions', 'revokedSessionCount', 'purpose', 'visibility', 'mimeType', 'sizeBytes', 'attachmentSlot', 'failureCode', 'moduleKey', 'formVersionId', 'editableFieldCount', 'editableAttachmentCount', 'publishedVersion', 'shape', 'status', 'organization', 'identityType', 'educationStage', 'submittedFrom', 'submittedTo', 'searchProvided', 'filters', 'columns', 'before', 'after', 'summary', 'fieldCount', 'valueTypes', 'array', 'object', 'string', 'number', 'boolean', 'null'])
const sensitiveText = (value: string) => /password|passwd|secret|token|cookie|verification|验证码|密码|手机号|(?:\+?86)?1[3-9]\d{9}|\$2[aby]\$|(?:^|\s)\/(?:Users|private|home|var)\//iu.test(value)
const safeText = (value: string | null | undefined, fallback: string) => value && !sensitiveText(value) ? value.slice(0, 200) : fallback
const safeValue = (value: unknown, depth: number): unknown => {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return sensitiveText(value) ? undefined : value.slice(0, 200)
  if (depth >= 4) return undefined
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => safeValue(item, depth + 1)).filter((item) => item !== undefined)
  if (!value || typeof value !== 'object') return undefined
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    if (!visibleMetadataKeys.has(key)) return []
    const sanitized = safeValue(child, depth + 1)
    return sanitized === undefined ? [] : [[key, sanitized] as const]
  }))
}
const safeMetadata = (metadata: Record<string, unknown>) => safeValue(metadata, 0) as Record<string, unknown>

export function AuditLogsPage({ client }: { client: AdminClient }) {
  const sequence = useRef(0); const detailSequence = useRef(0); const controller = useRef<AbortController | null>(null); const detailController = useRef<AbortController | null>(null)
  const [items, setItems] = useState<AuditLogItem[]>([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1); const [pageSize] = useState(20)
  const [loading, setLoading] = useState(true); const [error, setError] = useState(false); const [detail, setDetail] = useState<AuditLogItem | null>(null); const [detailError, setDetailError] = useState(false)
  const [filters, setFilters] = useState({ actorId: '', action: '', entityType: '', entityId: '', from: '', to: '' }); const [appliedFilters, setAppliedFilters] = useState(filters)

  const load = useCallback(async (targetPage: number, values: typeof filters) => {
    const current = ++sequence.current; controller.current?.abort(); const requestController = new AbortController(); controller.current = requestController
    detailSequence.current += 1; detailController.current?.abort(); detailController.current = null; setDetail(null); setDetailError(false)
    const query = new URLSearchParams({ page: String(targetPage), pageSize: String(pageSize) }); Object.entries(values).forEach(([key, value]) => { if (value) query.set(key, value) })
    setLoading(true); setError(false)
    try {
      const response = await client.listAuditLogs(query, requestController.signal)
      if (sequence.current !== current) return
      setItems(response.data.items); setTotal(response.data.total); setPage(response.data.page); setError(false)
    } catch (candidate) { if (sequence.current === current && !(candidate instanceof DOMException && candidate.name === 'AbortError')) setError(true) }
    finally { if (sequence.current === current) setLoading(false) }
  }, [client, pageSize])

  useEffect(() => { sequence.current += 1; detailSequence.current += 1; setItems([]); setDetail(null); void load(1, appliedFilters); return () => { sequence.current += 1; detailSequence.current += 1; controller.current?.abort(); detailController.current?.abort() } }, [client])
  const submit = (event: FormEvent) => { event.preventDefault(); setAppliedFilters(filters); void load(1, filters) }
  const openDetail = async (id: string) => {
    const current = ++detailSequence.current; detailController.current?.abort(); const requestController = new AbortController(); detailController.current = requestController; setDetail(null); setDetailError(false)
    try { const response = await client.getAuditLog(id, requestController.signal); if (detailSequence.current === current) setDetail(response.data.item) }
    catch (candidate) { if (detailSequence.current === current && !(candidate instanceof DOMException && candidate.name === 'AbortError')) { setDetail(null); setDetailError(true) } }
  }
  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  return <section className="page-section"><div className="page-heading"><div><p>安全审计</p><h1>操作日志</h1></div></div>
    <form className="panel filter-grid" onSubmit={submit}><label>操作者 ID<input value={filters.actorId} onChange={(event) => setFilters({ ...filters, actorId: event.target.value })} /></label><label>动作<input value={filters.action} onChange={(event) => setFilters({ ...filters, action: event.target.value })} /></label><label>对象类型<input value={filters.entityType} onChange={(event) => setFilters({ ...filters, entityType: event.target.value })} /></label><label>对象编号<input value={filters.entityId} onChange={(event) => setFilters({ ...filters, entityId: event.target.value })} /></label><label>开始日期<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label><label>结束日期<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label><button type="submit" disabled={loading}>筛选</button></form>
    {loading ? <p role="status">正在加载操作日志</p> : error ? <div><p role="alert">操作日志加载失败</p><button type="button" onClick={() => void load(page, appliedFilters)}>重试</button></div> : items.length === 0 ? <p>暂无操作日志</p> : <div className="panel"><table><thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>对象</th><th>修改摘要与结果</th><th>详情</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleString('zh-CN')}</td><td>{safeText(item.actor?.displayName, '系统')}</td><td>{safeText(item.action, '已隐藏')}</td><td>{safeText(item.entityType, '已隐藏')}{item.entityId ? ` / ${safeText(item.entityId, '已隐藏')}` : ''}</td><td><code>{JSON.stringify(safeMetadata(item.metadata))}</code></td><td><button type="button" onClick={() => void openDetail(item.id)}>查看详情</button></td></tr>)}</tbody></table><div className="button-row"><button type="button" disabled={page <= 1 || loading} onClick={() => void load(page - 1, appliedFilters)}>上一页</button><span>第 {page} / {lastPage} 页，共 {total} 条</span><button type="button" disabled={page >= lastPage || loading} onClick={() => void load(page + 1, appliedFilters)}>下一页</button></div></div>}
    {detailError ? <p role="alert">日志详情加载失败</p> : null}
    {detail ? <div role="dialog" aria-modal="true" aria-label="操作日志详情" className="panel"><h2>操作日志详情</h2><dl><dt>时间</dt><dd>{new Date(detail.createdAt).toLocaleString('zh-CN')}</dd><dt>操作者</dt><dd>{safeText(detail.actor?.displayName, '系统')}</dd><dt>动作</dt><dd>{safeText(detail.action, '已隐藏')}</dd><dt>对象</dt><dd>{safeText(detail.entityType, '已隐藏')}{detail.entityId ? ` / ${safeText(detail.entityId, '已隐藏')}` : ''}</dd><dt>摘要与结果</dt><dd><code>{JSON.stringify(safeMetadata(detail.metadata))}</code></dd></dl><button type="button" onClick={() => { detailSequence.current += 1; detailController.current?.abort(); setDetail(null) }}>关闭</button></div> : null}
  </section>
}
