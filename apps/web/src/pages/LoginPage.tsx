import { useState } from 'react'
import { Link } from 'react-router-dom'
import { loginStudent } from '../api/auth-client'
import { AuthActions, AuthCard, AuthField, AuthForm, AuthMessage, validPassword, validPhone } from '../features/auth/AuthForm'

export function LoginPage() {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const submit = async () => {
    if (pending) return
    if (!validPhone(phone) || !validPassword(password)) { setError('请输入有效的手机号和密码'); return }
    setPending(true); setError('')
    try { await loginStudent(phone, password); setSuccess(true) }
    catch (caught) { setError(caught instanceof Error ? caught.message : '登录失败，请稍后重试') }
    finally { setPending(false) }
  }

  return <AuthCard title="学员登录">
    <AuthForm onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <AuthField label="手机号" autoComplete="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
      <AuthField label="密码" autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
      <AuthActions><button disabled={pending} type="submit">{pending ? '正在登录' : '登录'}</button></AuthActions>
      {error ? <AuthMessage kind="error">{error}</AuthMessage> : null}
      {success ? <AuthMessage kind="status">登录成功，可前往个人中心。</AuthMessage> : null}
      <p className="auth-secondary"><Link to="/forgot-password">忘记密码</Link><span aria-hidden="true"> · </span><Link to="/register">注册账号</Link></p>
    </AuthForm>
  </AuthCard>
}
