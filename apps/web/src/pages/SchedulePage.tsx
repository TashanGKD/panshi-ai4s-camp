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
    {schedule.introduction ? <p className="schedule-introduction">{schedule.introduction}</p> : null}
    <div className="schedule-table-wrap" tabIndex={0} role="region" aria-label="实训营日程表">
      <table className="schedule-table">
        <colgroup>
          <col className="schedule-table__day" />
          <col className="schedule-table__time" />
          <col className="schedule-table__topic" />
          <col className="schedule-table__instructors" />
        </colgroup>
        <thead><tr>
          <th scope="col">日期 / 专题</th>
          <th scope="col">时间</th>
          <th scope="col">主题</th>
          <th scope="col">组织单位/授课师资</th>
        </tr></thead>
        {schedule.days.map((day) => <tbody key={day.date}>
          {day.sessions.length === 0 ? <tr>
            <th className="schedule-table__day-cell" scope="row">
              <time dateTime={day.date}>{day.label}</time>
              <span>{day.theme}</span>
            </th>
            <td className="schedule-table__pending" colSpan={3}>具体日程待发布</td>
          </tr> : null}
          {day.sessions.map((session, sessionIndex) => {
            const instructorNames = [
              ...(session.instructors ?? []),
              ...(session.speakerIds ?? []).map((speakerId) => speakers.get(speakerId) ?? speakerId),
            ]
            return <tr key={`${session.time ?? session.timeRange?.start ?? ''}:${session.title}`}>
              {sessionIndex === 0 ? <th className="schedule-table__day-cell" scope="rowgroup" rowSpan={day.sessions.length}>
                <time dateTime={day.date}>{day.label}</time>
                <span>{day.theme}</span>
              </th> : null}
              <td className="schedule-table__time-cell">{session.time ?? (session.timeRange ? `${session.timeRange.start}–${session.timeRange.end}` : '')}</td>
              <td className="schedule-table__topic-cell">{session.title}</td>
              <td><div className="schedule-table__stack schedule-table__instructor-list">{instructorNames.map((name) => <span key={name}>{name}</span>)}</div></td>
            </tr>
          })}
        </tbody>)}
      </table>
    </div>
  </section>
}
