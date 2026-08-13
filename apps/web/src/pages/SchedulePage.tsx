import { useEffect, useState } from 'react'
import type { PublicScheduleResponse } from '@panshi/contracts'
import { getPublicSchedule, PublicContentNotFoundError } from '../api/public-client'

type State = { status: 'loading' } | { status: 'empty' } | { status: 'error' } | {
  status: 'ready'
  data: PublicScheduleResponse['data']['schedule']
}

export function SchedulePage() {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let active = true
    void getPublicSchedule().then(
      ({ data }) => {
        if (active) setState(data.schedule.days.length === 0 ? { status: 'empty' } : { status: 'ready', data: data.schedule })
      },
      (error: unknown) => {
        if (active) setState(error instanceof PublicContentNotFoundError ? { status: 'empty' } : { status: 'error' })
      },
    )
    return () => { active = false }
  }, [])

  return <section className="public-page__section">
    <h2>实训日程</h2>
    {state.status === 'loading' ? <p role="status">正在加载实训日程</p> : null}
    {state.status === 'empty' ? <p>实训日程尚未发布</p> : null}
    {state.status === 'error' ? <p role="alert">实训日程暂时无法加载</p> : null}
    {state.status === 'ready' ? <ol className="schedule-list">{state.data.days.map((day) => <li key={day.date}>
      <p className="schedule-list__date">{day.label} · {day.date}</p>
      <h3>{day.theme}</h3>
      {day.sessions.length > 0 ? <ul>{day.sessions.map((session) => <li key={`${session.time ?? ''}:${session.title}`}>{session.time ? `${session.time} ` : ''}{session.title}</li>)}</ul> : null}
    </li>)}</ol> : null}
  </section>
}
