import type { JsonObject, JsonValue } from '@panshi/contracts'
import { CollectionActions, FieldError, RichTextField, TextField, errorDescription, moveItem, type FieldErrors } from '../../features/forms/form-utils'

type FormProps = { value: JsonObject, errors: FieldErrors, onChange: (value: JsonObject) => void }
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
const array = (value: unknown): JsonValue[] => Array.isArray(value) ? value : []
const text = (value: unknown) => typeof value === 'string' ? value : ''

export function BasicForm({ value, errors, onChange }: FormProps) {
  const data = object(value); const dates = object(data.dates); const intro = array(data.intro)
  const set = (key: string, next: JsonValue) => onChange({ ...data, [key]: next })
  const setDate = (key: string, next: string) => set('dates', { ...dates, [key]: next })
  return <div className="structured-form">
    <TextField label="实训营名称" path="title" value={text(data.title)} errors={errors} onChange={(next) => set('title', next)} />
    <div className="form-grid"><TextField label="开始日期" path="dates.start" type="date" value={text(dates.start)} errors={errors} onChange={(next) => setDate('start', next)} />
      <TextField label="结束日期" path="dates.end" type="date" value={text(dates.end)} errors={errors} onChange={(next) => setDate('end', next)} /></div>
    <TextField label="日期展示文字" path="dates.label" value={text(dates.label)} errors={errors} onChange={(next) => setDate('label', next)} />
    <TextField label="举办地点" path="venue" value={text(data.venue)} errors={errors} onChange={(next) => set('venue', next)} />
    <TextField label="首页标语" path="tagline" value={text(data.tagline)} errors={errors} onChange={(next) => set('tagline', next)} />
    <TextField label="招生对象" path="target" value={text(data.target)} errors={errors} onChange={(next) => set('target', next)} />
    {intro.map((item, index) => <RichTextField key={index} label={`简介段落 ${index + 1}`} path={`intro.${index}`} value={text(item)} errors={errors} onChange={(next) => set('intro', intro.map((entry, itemIndex) => itemIndex === index ? next : entry))} />)}
    <button type="button" className="button-secondary" onClick={() => set('intro', [...intro, '<p></p>'])}>添加简介段落</button>
  </div>
}

export function FeaturesForm({ value, errors, onChange }: FormProps) {
  const data = object(value); const items = array(data.items)
  const update = (next: JsonValue[]) => onChange({ ...data, items: next })
  return <div className="structured-form collection-list">{items.map((raw, index) => {
    const item = object(raw); const label = text(item.title)
    return <fieldset key={index} data-testid="feature-item"><legend>特色 {index + 1}</legend>
      <TextField label="特色标题" path={`items.${index}.title`} value={label} errors={errors} onChange={(next) => update(items.map((entry, itemIndex) => itemIndex === index ? { ...object(entry), title: next } : entry))} />
      <RichTextField label="特色说明" path={`items.${index}.description`} value={text(item.description)} errors={errors} onChange={(next) => update(items.map((entry, itemIndex) => itemIndex === index ? { ...object(entry), description: next } : entry))} />
      <CollectionActions label={label || '特色'} index={index} length={items.length} onMove={(direction) => update(moveItem(items, index, direction))} onDelete={() => update(items.filter((_, itemIndex) => itemIndex !== index))} />
    </fieldset>
  })}<button type="button" className="button-secondary" onClick={() => update([...items, { title: '', description: '' }])}>添加特色</button></div>
}

export function OrganizationsForm({ value, errors, onChange }: FormProps) {
  const data = object(value); const items = array(data.items); const update = (next: JsonValue[]) => onChange({ ...data, items: next })
  return <div className="structured-form collection-list">{items.map((raw, index) => { const item = object(raw); const label = text(item.name)
    return <fieldset key={index}><legend>单位 {index + 1}</legend><div className="form-grid">
      <TextField label="单位类型" path={`items.${index}.role`} value={text(item.role)} errors={errors} onChange={(next) => update(items.map((entry, i) => i === index ? { ...object(entry), role: next } : entry))} />
      <TextField label="单位全称" path={`items.${index}.name`} value={label} errors={errors} onChange={(next) => update(items.map((entry, i) => i === index ? { ...object(entry), name: next } : entry))} />
    </div><CollectionActions label={label} index={index} length={items.length} onMove={(direction) => update(moveItem(items, index, direction))} onDelete={() => update(items.filter((_, i) => i !== index))} /></fieldset>
  })}<button type="button" className="button-secondary" onClick={() => update([...items, { role: '', name: '' }])}>添加单位</button></div>
}

const dateKeyLabels = { registrationOpen: '报名开放', registrationDeadline: '报名截止', campStart: '实训开始', campEnd: '实训结束' }
export function ImportantDatesForm({ value, errors, onChange }: FormProps) {
  const data = object(value); const items = array(data.items); const update = (next: JsonValue[]) => onChange({ ...data, items: next })
  return <div className="structured-form collection-list">{items.map((raw, index) => { const item = object(raw); const label = text(item.label)
    return <fieldset key={index}><legend>日期 {index + 1}</legend><div className="form-grid">
      <TextField label="事项" path={`items.${index}.label`} value={label} errors={errors} onChange={(next) => update(items.map((entry, i) => i === index ? { ...object(entry), label: next } : entry))} />
      <TextField label="日期" path={`items.${index}.value`} type="date" value={text(item.value)} errors={errors} onChange={(next) => update(items.map((entry, i) => i === index ? { ...object(entry), value: next } : entry))} />
      <div className="form-field"><label htmlFor={`date-key-${index}`}>日期用途</label><select id={`date-key-${index}`} value={text(item.machineKey)} aria-describedby={errorDescription(`items.${index}.machineKey`, errors)} onChange={(event) => update(items.map((entry, i) => { if (i !== index) return entry; const next = { ...object(entry) }; if (event.target.value) next.machineKey = event.target.value; else delete next.machineKey; return next }))}><option value="">普通展示日期</option>{Object.entries(dateKeyLabels).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select><FieldError path={`items.${index}.machineKey`} errors={errors} /></div>
    </div><CollectionActions label={label} index={index} length={items.length} onMove={(direction) => update(moveItem(items, index, direction))} onDelete={() => update(items.filter((_, i) => i !== index))} /></fieldset>
  })}<FieldError path="items.registrationOpen" errors={errors} /><FieldError path="items.registrationDeadline" errors={errors} /><FieldError path="items.campStart" errors={errors} /><FieldError path="items.campEnd" errors={errors} />
  <button type="button" className="button-secondary" onClick={() => update([...items, { label: '', value: '' }])}>添加重要日期</button></div>
}

export function TravelForm({ value, errors, onChange }: FormProps) {
  const data = object(value); const sections = array(data.sections); const update = (next: JsonValue[]) => onChange({ ...data, sections: next })
  return <div className="structured-form collection-list">{sections.map((raw, index) => { const section = object(raw); const label = text(section.title)
    return <fieldset key={index}><legend>交通住宿内容 {index + 1}</legend>
      <TextField label="小节标题" path={`sections.${index}.title`} value={label} errors={errors} onChange={(next) => update(sections.map((entry, i) => i === index ? { ...object(entry), title: next } : entry))} />
      <RichTextField label={`${label || '小节'}内容`} path={`sections.${index}.body`} value={text(section.body)} errors={errors} onChange={(next) => update(sections.map((entry, i) => i === index ? { ...object(entry), body: next } : entry))} />
      <CollectionActions label={label} index={index} length={sections.length} onMove={(direction) => update(moveItem(sections, index, direction))} onDelete={() => update(sections.filter((_, i) => i !== index))} />
    </fieldset>
  })}<button type="button" className="button-secondary" onClick={() => update([...sections, { title: '', body: '' }])}>添加交通住宿小节</button></div>
}

export function ContactsForm({ value, errors, onChange }: FormProps) {
  const data = object(value); const items = array(data.items); const update = (next: JsonValue[]) => onChange({ ...data, items: next })
  return <div className="structured-form collection-list">{items.map((raw, index) => { const item = object(raw); const methods = array(item.methods); const method = object(methods[0]); const label = text(item.name)
    return <fieldset key={index}><legend>联系人 {index + 1}</legend><div className="form-grid">
      <TextField label="联系人姓名" path={`items.${index}.name`} value={label} errors={errors} onChange={(next) => update(items.map((entry, i) => i === index ? { ...object(entry), name: next } : entry))} />
      <TextField label="负责事项" path={`items.${index}.responsibility`} value={text(item.responsibility)} errors={errors} onChange={(next) => update(items.map((entry, i) => i === index ? { ...object(entry), responsibility: next } : entry))} />
      <div className="form-field"><label htmlFor={`contact-type-${index}`}>联系方式类型</label><select id={`contact-type-${index}`} value={text(method.type) || 'email'} onChange={(event) => update(items.map((entry, i) => i === index ? { ...object(entry), methods: [{ ...method, type: event.target.value }] } : entry))}><option value="email">邮箱</option><option value="phone">电话</option></select></div>
      <TextField label="联系方式" path={`items.${index}.methods.0.value`} type={method.type === 'phone' ? 'tel' : 'email'} value={text(method.value)} errors={errors} onChange={(next) => update(items.map((entry, i) => i === index ? { ...object(entry), methods: [{ type: text(method.type) || 'email', value: next }] } : entry))} />
    </div><TextField label="咨询说明" path={`items.${index}.consultationNote`} value={text(item.consultationNote)} errors={errors} onChange={(next) => update(items.map((entry, i) => i === index ? { ...object(entry), consultationNote: next } : entry))} />
    <CollectionActions label={label} index={index} length={items.length} onMove={(direction) => update(moveItem(items, index, direction))} onDelete={() => update(items.filter((_, i) => i !== index))} /></fieldset>
  })}<FieldError path="items" errors={errors} /><button type="button" className="button-secondary" onClick={() => update([...items, { name: '', responsibility: '', methods: [{ type: 'email', value: '' }] }])}>添加联系人</button></div>
}

export function DisplayForm({ value, errors, onChange }: FormProps) {
  const data = object(value); const visible = array(data.visibleNavigation).map(String)
  const set = (key: string, next: JsonValue) => onChange({ ...data, [key]: next })
  return <div className="structured-form"><TextField label="系列名称" path="series" value={text(data.series)} errors={errors} onChange={(next) => set('series', next)} /><TextField label="页脚文字" path="footer" value={text(data.footer)} errors={errors} onChange={(next) => set('footer', next)} />
    <label className="check-field"><input type="checkbox" checked={data.showRegistrationCount === true} onChange={(event) => set('showRegistrationCount', event.target.checked)} />公开显示已提交报名人数</label>
    <fieldset><legend>公开导航</legend>{['home', 'schedule', 'register', 'travel', 'contacts', 'resources'].map((key) => <label className="check-field" key={key}><input type="checkbox" checked={visible.includes(key)} onChange={(event) => set('visibleNavigation', event.target.checked ? [...visible, key] : visible.filter((item) => item !== key))} />{key}</label>)}</fieldset>
  </div>
}

export function ScheduleForm({ value, errors, onChange }: FormProps) {
  const data = object(value); const speakers = array(data.speakers); const days = array(data.days)
  const set = (key: string, next: JsonValue) => onChange({ ...data, [key]: next })
  return <div className="structured-form"><h3>讲师库</h3>{speakers.map((raw, index) => { const speaker = object(raw); const label = text(speaker.name)
    return <fieldset key={index}><legend>讲师 {index + 1}</legend><div className="form-grid"><TextField label="讲师 ID" path={`speakers.${index}.id`} value={text(speaker.id)} errors={errors} onChange={(next) => set('speakers', speakers.map((entry, i) => i === index ? { ...object(entry), id: next } : entry))} /><TextField label="讲师姓名" path={`speakers.${index}.name`} value={label} errors={errors} onChange={(next) => set('speakers', speakers.map((entry, i) => i === index ? { ...object(entry), name: next } : entry))} /></div><CollectionActions label={label} index={index} length={speakers.length} onMove={(direction) => set('speakers', moveItem(speakers, index, direction))} onDelete={() => set('speakers', speakers.filter((_, i) => i !== index))} /></fieldset>
  })}<button type="button" className="button-secondary" onClick={() => set('speakers', [...speakers, { id: '', name: '' }])}>添加讲师</button>
    <h3>日程</h3>{days.map((raw, dayIndex) => { const day = object(raw); const sessions = array(day.sessions); const label = text(day.label)
      const updateDay = (next: JsonObject) => set('days', days.map((entry, i) => i === dayIndex ? next : entry))
      return <fieldset key={dayIndex}><legend>{label || `第 ${dayIndex + 1} 天`}</legend><div className="form-grid"><TextField label="日期" type="date" path={`days.${dayIndex}.date`} value={text(day.date)} errors={errors} onChange={(next) => updateDay({ ...day, date: next })} /><TextField label="日期标签" path={`days.${dayIndex}.label`} value={label} errors={errors} onChange={(next) => updateDay({ ...day, label: next })} /><TextField label="当日主题" path={`days.${dayIndex}.theme`} value={text(day.theme)} errors={errors} onChange={(next) => updateDay({ ...day, theme: next })} /></div>
        {sessions.map((rawSession, sessionIndex) => { const session = object(rawSession); const range = object(session.timeRange); const sessionLabel = text(session.title)
          const updateSession = (next: JsonObject) => updateDay({ ...day, sessions: sessions.map((entry, i) => i === sessionIndex ? next : entry) })
          const base = `days.${dayIndex}.sessions.${sessionIndex}`
          return <fieldset key={sessionIndex} className="nested-fieldset"><legend>课程 {sessionIndex + 1}</legend><TextField label="课程主题" path={`${base}.title`} value={sessionLabel} errors={errors} onChange={(next) => updateSession({ ...session, title: next })} /><div className="form-grid"><TextField label="开始时间" type="time" path={`${base}.timeRange.start`} value={text(range.start)} errors={errors} onChange={(next) => updateSession({ ...session, timeRange: { ...range, start: next } })} /><TextField label="结束时间" type="time" path={`${base}.timeRange.end`} value={text(range.end)} errors={errors} onChange={(next) => updateSession({ ...session, timeRange: { ...range, end: next } })} /></div><FieldError path={`${base}.timeRange`} errors={errors} /><div className="form-field"><label htmlFor={`speaker-${dayIndex}-${sessionIndex}`}>拟邀请讲师</label><select id={`speaker-${dayIndex}-${sessionIndex}`} multiple value={array(session.speakerIds).map(String)} aria-describedby={errorDescription(`${base}.speakerIds`, errors)} onChange={(event) => updateSession({ ...session, speakerIds: Array.from(event.target.selectedOptions).map((option) => option.value) })}>{speakers.map((rawSpeaker) => { const speaker = object(rawSpeaker); return <option key={text(speaker.id)} value={text(speaker.id)}>{text(speaker.name)}</option> })}</select><FieldError path={`${base}.speakerIds`} errors={errors} /></div>{array(session.instructors).length > 0 ? <div className="legacy-warning"><p>该课程仍含旧版讲师文本，发布前请移除并改用讲师库。</p><FieldError path={`${base}.instructors`} errors={errors} /><button type="button" className="button-secondary" onClick={() => { const next = { ...session }; delete next.instructors; updateSession(next) }}>移除旧讲师文本</button></div> : null}<CollectionActions label={sessionLabel} index={sessionIndex} length={sessions.length} onMove={(direction) => updateDay({ ...day, sessions: moveItem(sessions, sessionIndex, direction) })} onDelete={() => updateDay({ ...day, sessions: sessions.filter((_, i) => i !== sessionIndex) })} /></fieldset>
        })}<button type="button" className="button-secondary" onClick={() => updateDay({ ...day, sessions: [...sessions, { title: '', timeRange: { start: '', end: '' }, speakerIds: [] }] })}>添加课程</button><CollectionActions label={label} index={dayIndex} length={days.length} onMove={(direction) => set('days', moveItem(days, dayIndex, direction))} onDelete={() => set('days', days.filter((_, i) => i !== dayIndex))} /></fieldset>
    })}<button type="button" className="button-secondary" onClick={() => set('days', [...days, { date: '', label: '', theme: '', sessions: [] }])}>添加日程日</button></div>
}
