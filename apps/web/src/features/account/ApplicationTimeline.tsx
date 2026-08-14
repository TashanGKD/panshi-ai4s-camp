import type { MyApplicationResponse } from '@panshi/contracts'

const labels = { draft: '草稿', submitted: '已提交', reviewing: '审核中', needs_supplement: '待补充材料', admitted: '已录取', waitlisted: '候补', rejected: '未录取' } as const

export function ApplicationTimeline({ entries }: { entries: MyApplicationResponse['data']['timeline'] }) {
  return <ol className="application-timeline">
    {entries.map((entry, index) => <li key={`${entry.createdAt}-${index}`}><strong>{labels[entry.status]}</strong><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString('zh-CN')}</time>{entry.publicReason ? <p>{entry.publicReason}</p> : null}</li>)}
  </ol>
}
