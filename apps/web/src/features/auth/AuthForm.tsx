import { useEffect, useState, type FormEventHandler, type InputHTMLAttributes, type ReactNode } from 'react'

export function AuthCard({ title, children }: { title: string, children: ReactNode }) {
  return <section className="public-page__section auth-card"><h2>{title}</h2>{children}</section>
}

export function AuthField({ label, ...input }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <label className="auth-field"><span>{label}</span><input {...input} /></label>
}

export function AuthForm({ children, onSubmit }: { children: ReactNode, onSubmit: FormEventHandler<HTMLFormElement> }) {
  return <form className="auth-form" noValidate onSubmit={onSubmit}>{children}</form>
}

export function AuthMessage({ kind, children }: { kind: 'error' | 'status', children: ReactNode }) {
  return <p className={`auth-message auth-message--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</p>
}

export function AuthActions({ children }: { children: ReactNode }) {
  return <div className="auth-actions">{children}</div>
}

export const useResendCountdown = (initialSeconds = 60) => {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (seconds <= 0) return
    const timer = window.setTimeout(() => setSeconds((value) => Math.max(0, value - 1)), 1_000)
    return () => window.clearTimeout(timer)
  }, [seconds])
  return { seconds, start: () => setSeconds(initialSeconds) }
}

export const validPhone = (value: string) => /^(?:\+86)?1[3-9]\d{9}$/u.test(value)
export const validCode = (value: string) => /^\d{6}$/u.test(value)
export const validPassword = (value: string) => {
  const bytes = new TextEncoder().encode(value).byteLength
  return bytes >= 8 && bytes <= 72
}
