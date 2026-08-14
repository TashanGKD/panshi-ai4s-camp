import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { MyApplicationResponse } from '@panshi/contracts'
import { applicationClient, ApplicationApiError } from '../api/application-client'
import { ApplicationTimeline } from '../features/account/ApplicationTimeline'

const statusLabels = { draft: '草稿', submitted: '已提交', reviewing: '审核中', needs_supplement: '待补充材料', admitted: '已录取', waitlisted: '候补', rejected: '未录取' } as const

export function AccountPage() {
  const [data, setData] = useState<MyApplicationResponse['data'] | null>(null)
  const [message, setMessage] = useState('正在加载个人中心')
  useEffect(() => {
    let active = true
    void applicationClient.getMine().then((response) => { if (active) { setData(response.data); setMessage('') } }, async (error) => {
      if (!active) return
      if (error instanceof ApplicationApiError && error.code === 'ACCOUNT_DISABLED') { await applicationClient.logout().catch(() => undefined); setMessage('账号已停用，当前会话已退出。') }
      else if (error instanceof ApplicationApiError && error.status === 401) setMessage('请先登录后查看个人中心。')
      else setMessage('个人中心暂时无法加载。')
    })
    return () => { active = false }
  }, [])
  if (!data) return <p role="status">{message}</p>
  const { application } = data
  return <section><h2>个人中心</h2><dl className="profile-summary"><dt>姓名</dt><dd>{application.profile.name}</dd><dt>手机号</dt><dd>{application.profile.phone}</dd><dt>单位</dt><dd>{application.profile.organization || '尚未填写'}</dd><dt>当前状态</dt><dd>{statusLabels[application.status]}</dd></dl>
    <p><Link to="/application">{application.locked ? '查看报名信息' : '继续填写报名'}</Link></p>
    <h3>状态时间线</h3><ApplicationTimeline entries={data.timeline} />
    <h3>补充要求</h3><p>{data.supplementRequest?.message ?? '暂无补充要求'}</p>
    <h3>可访问资料</h3>{data.accessibleResources.length ? <ul>{data.accessibleResources.map((resource) => <li key={resource.id}><a href={resource.downloadUrl}>{resource.title}</a></li>)}</ul> : <p>暂无可访问资料</p>}
  </section>
}
