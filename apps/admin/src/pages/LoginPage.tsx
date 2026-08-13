import { useState, type FormEvent } from 'react'
import type { AdminLoginRequest } from '@panshi/contracts'

export const LoginPage = ({ onLogin }: { onLogin: (input: AdminLoginRequest) => Promise<void> }) => {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(undefined); setSubmitting(true)
    try { await onLogin({ phone, password }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '登录失败') }
    finally { setSubmitting(false) }
  }
  return <main className="login-shell"><form className="login-card" onSubmit={(event) => { void submit(event) }}>
    <h1>磐石管理后台</h1>
    <label htmlFor="phone">手机号</label>
    <input id="phone" type="tel" autoComplete="username" required value={phone} onChange={(event) => setPhone(event.target.value)} />
    <label htmlFor="password">密码</label>
    <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
    {error && <p role="alert">{error}</p>}
    <button type="submit" disabled={submitting}>{submitting ? '正在登录…' : '登录'}</button>
  </form></main>
}
