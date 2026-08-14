import { useState } from 'react'
import { Link } from 'react-router-dom'
import { resetStudentPassword, sendVerificationCode } from '../api/auth-client'
import { AuthActions, AuthCard, AuthField, AuthForm, AuthMessage, useResendCountdown, validCode, validPassword, validPhone } from '../features/auth/AuthForm'

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const countdown = useResendCountdown()

  const sendCode = async () => {
    if (pending) return
    if (!validPhone(phone)) { setError('请输入有效的中国大陆手机号'); return }
    setPending(true); setError('')
    try { await sendVerificationCode(phone, 'reset_password'); setSent(true); countdown.start() }
    catch (caught) { setError(caught instanceof Error ? caught.message : '验证码发送失败，请稍后重试') }
    finally { setPending(false) }
  }

  const reset = async () => {
    if (pending) return
    if (!validCode(code)) { setError('请输入6位数字验证码'); return }
    if (!validPassword(password)) { setError('密码须为8至72个UTF-8字节'); return }
    if (password !== confirmation) { setError('两次输入的密码不一致'); return }
    setPending(true); setError('')
    try { await resetStudentPassword(phone, code, password); setSuccess(true) }
    catch (caught) { setError(caught instanceof Error ? caught.message : '密码重置失败，请稍后重试') }
    finally { setPending(false) }
  }

  return <AuthCard title="忘记密码">
    {success ? <>
      <AuthMessage kind="status">密码已重置，请使用新密码登录。</AuthMessage>
      <AuthActions><Link className="auth-button" to="/login">返回登录</Link></AuthActions>
    </> : <AuthForm onSubmit={(event) => { event.preventDefault(); if (sent) void reset(); else void sendCode() }}>
      <AuthField label="手机号" autoComplete="tel" disabled={sent} inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
      {!sent ? <AuthActions><button disabled={pending} type="submit">{pending ? '正在发送' : '获取验证码'}</button></AuthActions> : <>
        <p>如手机号可用于重置，验证码已发送。</p>
        <AuthField label="验证码" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} />
        <AuthField label="新密码" autoComplete="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        <AuthField label="确认新密码" autoComplete="new-password" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        <AuthActions>
          <button disabled={pending || countdown.seconds > 0} onClick={() => void sendCode()} type="button">{countdown.seconds > 0 ? `重新发送（${countdown.seconds}秒）` : '重新发送'}</button>
          <button disabled={pending} type="submit">{pending ? '正在重置' : '重置密码'}</button>
        </AuthActions>
      </>}
      {error ? <AuthMessage kind="error">{error}</AuthMessage> : null}
      <p className="auth-secondary"><Link to="/login">返回登录</Link></p>
    </AuthForm>}
  </AuthCard>
}
