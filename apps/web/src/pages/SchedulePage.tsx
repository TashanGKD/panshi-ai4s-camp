import { useEffect, useState } from 'react'
import type { PublicScheduleResponse, ScheduleContent as ScheduleContentType } from '@panshi/contracts'
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

  if (state.status === 'ready') return <ScheduleContent schedule={state.data} />
  return <section className="public-page__section">
    <h2>实训日程</h2>
    {state.status === 'loading' ? <p role="status">正在加载实训日程</p> : null}
    {state.status === 'empty' ? <p>实训日程尚未发布</p> : null}
    {state.status === 'error' ? <p role="alert">实训日程暂时无法加载</p> : null}
  </section>
}

export function ScheduleContent({ schedule }: { schedule: ScheduleContentType }) {
  const speakers = new Map(schedule.speakers?.map((speaker) => [speaker.id, speaker.name]))
  return <section className="public-page__section">
    <h2>实训日程</h2>
    <ol className="schedule-list">{schedule.days.map((day) => <li key={day.date}>
      <p className="schedule-list__date">{day.label} · {day.date}</p>
      <h3>{day.theme}</h3>
      {day.sessions.length > 0 ? <ul>{day.sessions.map((session) => <li key={`${session.time ?? ''}:${session.title}`}>
        <article>
          <h4>{session.title}</h4>
          {session.timeRange || session.time ? <p><strong>时间：</strong><span>{session.timeRange ? `${session.timeRange.start}–${session.timeRange.end}` : session.time}</span></p> : null}
          {session.details && session.details.length > 0 ? <section>
            <h5>课程详情</h5>
            <ul>{session.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
          </section> : null}
          {session.instructors && session.instructors.length > 0 ? <section>
            <h5>授课教师</h5>
            <ul>{session.instructors.map((instructor) => <li key={instructor}>{instructor}</li>)}</ul>
          </section> : null}
          {session.speakerIds && session.speakerIds.length > 0 ? <section>
            <h5>授课教师</h5>
            <ul>{session.speakerIds.map((speakerId) => <li key={speakerId}>{speakers.get(speakerId) ?? speakerId}</li>)}</ul>
          </section> : null}
        </article>
      </li>)}</ul> : null}
    </li>)}</ol>
  </section>
}
