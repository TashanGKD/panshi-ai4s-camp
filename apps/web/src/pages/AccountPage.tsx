import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { MyApplicationResponse } from '@panshi/contracts'
import { applicationClient, ApplicationApiError } from '../api/application-client'
import { ApplicationTimeline } from '../features/account/ApplicationTimeline'
import { changeStudentPassword, logoutStudent } from '../api/auth-client'

const statusLabels = { draft: '草稿', submitted: '已提交', reviewing: '审核中', needs_supplement: '待补充材料', admitted: '已录取', waitlisted: '候补', rejected: '未录取' } as const

export function AccountPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<MyApplicationResponse['data'] | null>(null)
  const [message, setMessage] = useState('正在加载个人中心')
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' })
  const [securityMessage, setSecurityMessage] = useState('')
  const [pending, setPending] = useState(false)
  useEffect(() => {
    let active = true
    void applicationClient.getMine().then((response) => { if (active) { setData(response.data); setMessage('') } }, async (error) => {
      if (!active) return
      if (error instanceof ApplicationApiError && error.code === 'ACCOUNT_DISABLED') { await applicationClient.logout().catch(() => undefined); if (active) setMessage('账号已停用，当前会话已退出。') }
      else if (error instanceof ApplicationApiError && error.status === 401) setMessage('请先登录后查看个人中心。')
      else setMessage('个人中心暂时无法加载。')
    })
    return () => { active = false }
  }, [])
  if (!data) return <p role="status">{message}</p>
  const logout = async () => { if (pending) return; setPending(true); await logoutStudent().catch(() => undefined); navigate('/login', { replace: true }) }
  const changePassword = async (event: FormEvent) => {
    event.preventDefault(); if (pending) return; setPending(true); setSecurityMessage('')
    try { await changeStudentPassword(passwords.currentPassword, passwords.newPassword); setPasswords({ currentPassword: '', newPassword: '' }); navigate('/login', { replace: true }) }
    catch (error) { setSecurityMessage(error instanceof Error ? error.message : '密码修改失败') }
    finally { setPending(false) }
  }
  const { application } = data
  return <section><h2>个人中心</h2><dl className="profile-summary"><dt>姓名</dt><dd>{application.profile.name}</dd><dt>手机号</dt><dd>{application.profile.phone}</dd><dt>单位</dt><dd>{application.profile.organization || '尚未填写'}</dd><dt>当前状态</dt><dd>{statusLabels[application.status]}</dd></dl>
    <p><Link to="/application">{application.locked ? '查看报名信息' : '继续填写报名'}</Link></p>
    <h3>状态时间线</h3><ApplicationTimeline entries={data.timeline} />
    <h3>补充要求</h3><p>{data.supplementRequest?.message ?? '暂无补充要求'}</p>
    <h3>可访问资料</h3>{data.accessibleResources.length ? <ul>{data.accessibleResources.map((resource) => <li key={resource.id}><a href={resource.downloadUrl}>{resource.title}</a></li>)}</ul> : <p>暂无可访问资料</p>}
    <section aria-labelledby="account-security"><h3 id="account-security">账号安全</h3>{securityMessage ? <p role="status">{securityMessage}</p> : null}<form className="auth-form" onSubmit={(event) => void changePassword(event)}><label>当前密码<input required type="password" autoComplete="current-password" value={passwords.currentPassword} disabled={pending} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} /></label><label>新密码<input required type="password" minLength={8} autoComplete="new-password" value={passwords.newPassword} disabled={pending} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} /></label><button type="submit" disabled={pending}>修改密码并退出全部设备</button></form><p><Link to="/forgot-password">通过验证码重置密码</Link></p><button type="button" disabled={pending} onClick={() => void logout()}>退出登录</button></section>
  </section>
}
