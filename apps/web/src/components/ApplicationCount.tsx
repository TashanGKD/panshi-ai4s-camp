import { useEffect, useRef, useState } from 'react'
import type { ApplicationCountResponse } from '@panshi/contracts'
import { getApplicationCount } from '../api/public-client'

type Count = ApplicationCountResponse['data']

export function ApplicationCount({ load = getApplicationCount }: { load?: (signal: AbortSignal) => Promise<Count> }) {
  const [state, setState] = useState<{ value: Count | null, error: boolean }>({ value: null, error: false })
  const generation = useRef(0)
  const lastVisible = useRef(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    let active = true
    const clear = () => { if (timer) clearTimeout(timer); timer = undefined; controller?.abort() }
    const schedule = () => {
      if (!active || document.hidden) return
      timer = setTimeout(() => void refresh(), 60_000)
    }
    const refresh = async () => {
      if (!active || document.hidden) return
      const current = ++generation.current
      controller?.abort(); controller = new AbortController()
      let shouldPoll = false
      try {
        const value = await load(controller.signal)
        shouldPoll = value.visible
        lastVisible.current = value.visible
        if (active && current === generation.current) setState({ value, error: false })
      } catch (error) {
        shouldPoll = lastVisible.current
        if (active && current === generation.current && !(error instanceof DOMException && error.name === 'AbortError')) setState({ value: null, error: true })
      } finally {
        if (active && current === generation.current && shouldPoll) schedule()
      }
    }
    const onVisibility = () => { clear(); if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', onVisibility)
    void refresh()
    return () => { active = false; generation.current += 1; document.removeEventListener('visibilitychange', onVisibility); clear() }
  }, [load])

  if (state.error) return <p role="status">报名人数暂时无法获取</p>
  if (!state.value || !state.value.visible) return null
  return <section className="application-count" aria-label="报名人数">
    <span>已提交报名</span><strong>{state.value.submittedCount}</strong><span>人</span>
    <small>更新于 {new Date(state.value.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</small>
  </section>
}
