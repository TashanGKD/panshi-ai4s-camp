import { useState } from 'react'
import { Link } from 'react-router-dom'
import { registerStudent, sendVerificationCode } from '../api/auth-client'
import { AuthActions, AuthCard, AuthField, AuthForm, AuthMessage, useResendCountdown, validCode, validPassword, validPhone } from '../features/auth/AuthForm'

export function RegisterPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1)
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
    try {
      await sendVerificationCode(phone, 'register')
      countdown.start(); setStep(2)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '验证码发送失败，请稍后重试')
    } finally { setPending(false) }
  }

  const goToPassword = () => {
    if (!validCode(code)) { setError('请输入6位数字验证码'); return }
    setError(''); setStep(3)
  }

  const register = async () => {
    if (pending) return
    if (!validPassword(password)) { setError('密码须为8至72个UTF-8字节'); return }
    if (password !== confirmation) { setError('两次输入的密码不一致'); return }
    setPending(true); setError('')
    try {
      await registerStudent(phone, code, password)
      setSuccess(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '注册失败，请稍后重试')
    } finally { setPending(false) }
  }

  return <AuthCard title="在线注册">
    {success ? <>
      <AuthMessage kind="status">注册成功，请登录后继续填写报名信息。</AuthMessage>
      <AuthActions><Link className="auth-button" to="/login">前往登录</Link></AuthActions>
    </> : <AuthForm onSubmit={(event) => {
      event.preventDefault()
      if (step === 1) void sendCode()
      else if (step === 2) goToPassword()
      else void register()
    }}>
      <p className="auth-step" aria-live="polite">步骤 {step} / 3</p>
      {step === 1 ? <>
        <AuthField label="手机号" autoComplete="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
        <AuthActions><button disabled={pending} type="submit">{pending ? '正在发送' : '获取验证码'}</button></AuthActions>
      </> : null}
      {step === 2 ? <>
        <p>验证码已发送至所填手机号，请在有效期内完成注册。</p>
        <AuthField label="验证码" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} />
        <AuthActions>
          <button onClick={() => setStep(1)} type="button">修改手机号</button>
          <button disabled={pending || countdown.seconds > 0} onClick={() => void sendCode()} type="button">{countdown.seconds > 0 ? `重新发送（${countdown.seconds}秒）` : '重新发送'}</button>
          <button type="submit">下一步</button>
        </AuthActions>
      </> : null}
      {step === 3 ? <>
        <AuthField label="设置密码" autoComplete="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        <AuthField label="确认密码" autoComplete="new-password" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        <AuthActions><button disabled={pending} type="submit">{pending ? '正在创建' : '创建账号'}</button></AuthActions>
      </> : null}
      {error ? <AuthMessage kind="error">{error}</AuthMessage> : null}
      <p className="auth-secondary">已有账号？<Link to="/login">直接登录</Link></p>
    </AuthForm>}
  </AuthCard>
}
