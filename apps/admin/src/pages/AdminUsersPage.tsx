import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { AdminClient, Administrator } from '../api/admin-client'

type Confirmation = { kind: 'disable' | 'reset', administrator: Administrator }

export function AdminUsersPage({ client }: { client: AdminClient }) {
  const generation = useRef(0); const operation = useRef(0); const loadController = useRef<AbortController | null>(null)
  const [items, setItems] = useState<Administrator[]>([]); const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState(false)
  const [message, setMessage] = useState(''); const [pending, setPending] = useState(false)
  const [form, setForm] = useState({ displayName: '', phone: '', password: '', currentPassword: '' })
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null); const [confirmationPassword, setConfirmationPassword] = useState(''); const [newPassword, setNewPassword] = useState('')

  const load = useCallback(async () => {
    const current = ++generation.current; loadController.current?.abort(); const controller = new AbortController(); loadController.current = controller; setLoading(true); setLoadError(false)
    try {
      const response = await client.listAdministrators(controller.signal)
      if (generation.current !== current) return
      setItems(response.data.administrators); setLoadError(false)
    } catch (error) {
      if (generation.current === current && !(error instanceof DOMException && error.name === 'AbortError')) setLoadError(true)
    } finally { if (generation.current === current) setLoading(false) }
  }, [client])

  useEffect(() => { generation.current += 1; operation.current += 1; setItems([]); setMessage(''); setPending(false); setConfirmation(null); setConfirmationPassword(''); setNewPassword(''); setForm((value) => ({ ...value, password: '', currentPassword: '' })); void load(); return () => { generation.current += 1; operation.current += 1; loadController.current?.abort() } }, [load])

  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (pending) return
    const current = ++operation.current; const payload = form
    setForm((value) => ({ ...value, currentPassword: '' })); setPending(true); setMessage('')
    try {
      await client.createAdministrator(payload)
      if (operation.current !== current) return
      setForm({ displayName: '', phone: '', password: '', currentPassword: '' }); await load()
      if (operation.current === current) setMessage('管理员已新增')
    } catch (error) { if (operation.current === current) setMessage(error instanceof Error ? error.message : '新增失败') }
    finally { if (operation.current === current) setPending(false) }
  }

  const closeConfirmation = () => { setConfirmation(null); setConfirmationPassword(''); setNewPassword('') }
  const confirmOperation = async () => {
    if (!confirmation || pending || !confirmationPassword) return
    const current = ++operation.current; const target = confirmation; const currentPassword = confirmationPassword; const replacement = newPassword
    closeConfirmation(); setPending(true); setMessage('')
    try {
      if (target.kind === 'disable') await client.disableAdministrator(target.administrator.id, { currentPassword })
      else await client.resetAdministratorPassword(target.administrator.id, { currentPassword, newPassword: replacement })
      if (operation.current !== current) return
      await load(); if (operation.current === current) setMessage(target.kind === 'disable' ? '管理员已禁用' : '管理员密码已重置')
    } catch (error) { if (operation.current === current) setMessage(error instanceof Error ? error.message : target.kind === 'disable' ? '禁用失败' : '重置失败') }
    finally { if (operation.current === current) setPending(false) }
  }

  return <section className="page-section"><div className="page-heading"><div><p>权限与账号</p><h1>管理员账号</h1></div></div>
    {message ? <p role="status">{message}</p> : null}
    <div className="panel"><h2>现有管理员</h2>
      {loading ? <p role="status">正在加载管理员列表</p> : loadError ? <div><p role="alert">管理员列表加载失败</p><button type="button" onClick={() => void load()}>重试</button></div> : items.length === 0 ? <p>暂无管理员</p> : <table><thead><tr><th>管理员名称</th><th>手机号</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.displayName}{item.isCurrent ? '（当前账号）' : ''}</td><td>{item.phone}</td><td>{item.disabledAt ? '已禁用' : '有效'}</td><td>{new Date(item.createdAt).toLocaleString('zh-CN')}</td><td><div className="button-row"><button type="button" disabled={pending || Boolean(item.disabledAt) || item.isCurrent} onClick={() => { setConfirmation({ kind: 'disable', administrator: item }); setConfirmationPassword('') }}>禁用</button><button type="button" disabled={pending || Boolean(item.disabledAt)} onClick={() => { setConfirmation({ kind: 'reset', administrator: item }); setConfirmationPassword(''); setNewPassword('') }}>重置密码</button></div></td></tr>)}</tbody></table>}
    </div>
    <form className="panel form-stack" onSubmit={(event) => void submit(event)}><h2>新增管理员</h2><label>管理员名称<input required maxLength={100} value={form.displayName} disabled={pending} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label><label>手机号<input required value={form.phone} disabled={pending} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label><label>初始密码<input required type="password" autoComplete="new-password" minLength={12} value={form.password} disabled={pending} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label><label>当前管理员密码<input required type="password" autoComplete="current-password" value={form.currentPassword} disabled={pending} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} /></label><button disabled={pending} type="submit">{pending ? '正在新增' : '新增管理员'}</button></form>
    {confirmation ? <div role="dialog" aria-modal="true" aria-label={confirmation.kind === 'disable' ? '禁用管理员' : '重置管理员密码'} className="panel"><h2>{confirmation.kind === 'disable' ? '禁用管理员' : '重置管理员密码'}</h2><p>目标账号：{confirmation.administrator.displayName}</p>{confirmation.kind === 'reset' ? <label>新密码<input type="password" minLength={12} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label> : null}<label>再次输入当前密码<input type="password" autoComplete="current-password" value={confirmationPassword} onChange={(event) => setConfirmationPassword(event.target.value)} /></label><div className="button-row"><button type="button" onClick={closeConfirmation}>取消</button><button type="button" disabled={pending || !confirmationPassword || (confirmation.kind === 'reset' && !newPassword)} onClick={() => void confirmOperation()}>{confirmation.kind === 'disable' ? '确认禁用' : '确认重置'}</button></div></div> : null}
  </section>
}
