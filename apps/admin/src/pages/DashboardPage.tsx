import { useEffect, useState } from 'react'
import type { AdminSummaryResponse } from '@panshi/contracts'
import type { AdminClient } from '../api/admin-client'

const statusLabels = { draft: '草稿', submitted: '已提交', reviewing: '审核中', needs_supplement: '待补充', admitted: '已录取', waitlisted: '候补', rejected: '未录取' }

export function DashboardPage({ client }: { client: AdminClient }) {
  const [summary, setSummary] = useState<AdminSummaryResponse>()
  const [error, setError] = useState(false)
  useEffect(() => { let active = true; void client.getSummary().then((value) => { if (active) setSummary(value) }, () => { if (active) setError(true) }); return () => { active = false } }, [client])
  return <section className="page-section"><div className="page-heading"><div><p>运营概览</p><h1>工作台</h1></div></div>
    {error ? <p role="alert">工作台摘要暂时无法加载</p> : !summary ? <p role="status">正在加载工作台摘要</p> : <>
      <div className="metric-grid"><article><span>报名总量</span><strong>{summary.data.applications.total}</strong></article><article><span>待审核</span><strong>{summary.data.applications.pendingReview}</strong></article>{Object.entries(summary.data.applications.byStatus).map(([status, count]) => <article key={status}><span>{statusLabels[status as keyof typeof statusLabels]}</span><strong>{count}</strong></article>)}</div>
      <div className="dashboard-grid"><article className="panel"><h2>临近重要日期</h2>{summary.data.upcomingDates.length === 0 ? <p className="empty-state">暂无临近重要日期</p> : <ul>{summary.data.upcomingDates.map((item) => <li key={item.machineKey}><span>{item.label}</span><time dateTime={item.date}>{item.date}</time></li>)}</ul>}</article>
        <article className="panel"><h2>未发布草稿</h2>{summary.data.unpublishedDrafts.length === 0 ? <p className="empty-state">暂无未发布草稿</p> : <ul>{summary.data.unpublishedDrafts.map((item) => <li key={item.key}><span>{item.key}</span><span>修订 {item.revision}</span></li>)}</ul>}</article>
        <article className="panel"><h2>最近操作</h2>{summary.data.recentOperations.length === 0 ? <p className="empty-state">暂无最近操作</p> : <ul>{summary.data.recentOperations.map((item) => <li key={item.id}><div><span>{item.action}</span><small>{item.actorDisplayName ?? '系统'}</small></div><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('zh-CN')}</time></li>)}</ul>}</article>
      </div>
    </>}
  </section>
}
