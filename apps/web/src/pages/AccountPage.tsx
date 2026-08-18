import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import type { ApplicationCoreFields, MyApplicationResponse, StudentCheckInResponse } from '@panshi/contracts'
import { applicationClient, ApplicationApiError } from '../api/application-client'
import { changeStudentPassword, logoutStudent } from '../api/auth-client'
import { ApplicationTimeline } from '../features/account/ApplicationTimeline'

const statusLabels = { draft: '草稿', submitted: '待审核', reviewing: '审核中', needs_supplement: '待补充材料', admitted: '已录取', waitlisted: '候补', rejected: '未录取' } as const
type Tab = 'profile' | 'security' | 'check-in'

const profileRows = (profile: ApplicationCoreFields) => [
  ['姓名', profile.name], ['手机号', profile.phone], ['电子邮箱', profile.email], ['当前身份', profile.identityType],
  ['所在单位', profile.organization], ['院系／培养单位', profile.department], ['专业', profile.major],
  ['研究方向', profile.researchDirection], ['研究兴趣', profile.researchInterest], ['博士后流动站', profile.postdocStation],
  ['学科领域', profile.disciplineField], ['导师', profile.supervisor], ['工作岗位／职务', profile.jobPosition],
  ['专业技术职称等级', profile.professionalTitleLevel], ['具体职称', profile.specificTitle], ['其他身份说明', profile.identityDescription],
].filter(([, value]) => value?.trim() !== '') as string[][]

export function AccountPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<MyApplicationResponse['data'] | null>(null)
  const [checkIn, setCheckIn] = useState<StudentCheckInResponse | null>(null)
  const [tab, setTab] = useState<Tab>('profile')
  const [message, setMessage] = useState('正在加载个人中心')
  const [operationMessage, setOperationMessage] = useState('')
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' })
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let active = true
    applicationClient.getMine().then((response) => {
      if (!active) return
      setData(response.data); setMessage('')
      void applicationClient.getCheckIn().then((result) => { if (active) setCheckIn(result) }).catch(() => undefined)
    }, async (error) => {
      if (!active) return
      if (error instanceof ApplicationApiError && error.code === 'ACCOUNT_DISABLED') { await applicationClient.logout().catch(() => undefined); if (active) setMessage('账号已停用，当前会话已退出。') }
      else if (error instanceof ApplicationApiError && error.status === 401) setMessage('请先登录后查看个人中心。')
      else setMessage('个人中心暂时无法加载。')
    })
    return () => { active = false }
  }, [])

  const rows = useMemo(() => data ? profileRows(data.application.profile) : [], [data])
  if (!data) return <p role="status">{message}</p>
  const { application } = data
  const logout = async () => { if (pending) return; setPending(true); await logoutStudent().catch(() => undefined); navigate('/login', { replace: true }) }
  const changePassword = async (event: FormEvent) => {
    event.preventDefault(); if (pending) return; setPending(true); setOperationMessage('')
    try { await changeStudentPassword(passwords.currentPassword, passwords.newPassword); navigate('/login', { replace: true }) }
    catch (error) { setOperationMessage(error instanceof Error ? error.message : '密码修改失败') }
    finally { setPending(false) }
  }

  return <section className="account-center" aria-labelledby="account-title">
    <header className="account-center__heading"><div><p>学员个人中心</p><h2 id="account-title">{application.profile.name || '实训营学员'}</h2></div><span className={`account-status account-status--${application.status}`}>{statusLabels[application.status]}</span></header>
    <div className="account-center__layout">
      <nav className="account-tabs" aria-label="个人中心导航"><button className={tab === 'profile' ? 'is-active' : ''} onClick={() => setTab('profile')}>个人信息</button><button className={tab === 'security' ? 'is-active' : ''} onClick={() => setTab('security')}>账号安全</button><button className={tab === 'check-in' ? 'is-active' : ''} onClick={() => setTab('check-in')}>报到二维码</button></nav>
      <div className="account-panel">
        {operationMessage ? <p className="account-message" role="status">{operationMessage}</p> : null}
        {tab === 'profile' ? <><div className="account-panel__heading"><div><h3>个人信息</h3><p>用于实训营通知、审核和报到核验。</p></div><Link className="account-button account-button--secondary" to="/application">{application.status === 'submitted' ? '重新提交报名信息' : application.locked ? '查看报名信息' : '继续填写报名'}</Link></div><dl className="account-profile-list">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}<div><dt>报名状态</dt><dd><strong>{statusLabels[application.status]}</strong></dd></div></dl><div className="account-subsection"><div className="account-subsection__heading"><h4>报名进度</h4></div><ApplicationTimeline entries={data.timeline} />{data.supplementRequest ? <p className="account-notice"><strong>补充要求：</strong>{data.supplementRequest.message}</p> : null}</div></> : null}
        {tab === 'security' ? <><div className="account-panel__heading"><div><h3>账号安全</h3><p>手机号 {application.profile.phone} 是当前登录账号，不可在个人信息中修改。</p></div></div><form className="account-security-form" onSubmit={(event) => void changePassword(event)}><label>当前密码<input required type="password" autoComplete="current-password" value={passwords.currentPassword} disabled={pending} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} /></label><label>新密码<input required type="password" minLength={8} autoComplete="new-password" value={passwords.newPassword} disabled={pending} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} /></label><div className="account-actions"><button className="account-button" disabled={pending}>修改密码并退出全部设备</button><Link to="/forgot-password">通过验证码重置密码</Link></div></form><button className="account-button account-button--danger" type="button" disabled={pending} onClick={() => void logout()}>退出登录</button></> : null}
        {tab === 'check-in' ? <CheckInPanel value={checkIn} status={application.status} /> : null}
      </div>
    </div>
  </section>
}

function CheckInPanel({ value, status }: { value: StudentCheckInResponse | null, status: keyof typeof statusLabels }) {
  return <><div className="account-panel__heading"><div><h3>报到二维码</h3><p>录取后生成，到场时由会务人员扫码并确认报到。</p></div></div>{status !== 'admitted' ? <div className="check-in-placeholder"><span>待录取</span><h4>暂未开放报到码</h4><p>当报名状态更新为“已录取”后，此处将自动显示报到二维码。</p></div> : !value ? <p role="status">正在生成报到码……</p> : value.data.availability === 'unavailable' ? <div className="check-in-placeholder"><h4>暂无可用报到码</h4><p>{value.data.reason}</p></div> : <div className="check-in-card"><div className="check-in-card__qr"><QRCodeSVG value={value.data.qrPayload} size={232} level="M" marginSize={2} /></div><p>现场报到码</p><strong>{value.data.displayCode}</strong>{value.data.availability === 'checked_in' ? <span className="check-in-complete">已于 {new Date(value.data.checkedInAt).toLocaleString('zh-CN')} 完成报到</span> : <span>请勿将二维码转发给他人</span>}</div>}</>
}
