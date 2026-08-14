import type { JsonObject, JsonValue } from '@panshi/contracts'
import { useState } from 'react'
import {
  CollectionActions,
  FieldError,
  RichTextField,
  TextField,
  errorDescription,
  moveItem,
  useEditorKeys,
  type FieldErrors,
} from '../../features/forms/form-utils'

type FormProps = { value: JsonObject, errors: FieldErrors, onChange: (value: JsonObject) => void }
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
const array = (value: unknown): JsonValue[] => Array.isArray(value) ? value : []
const text = (value: unknown) => typeof value === 'string' ? value : ''

export function BasicForm({ value, errors, onChange }: FormProps) {
  const data = object(value)
  const dates = object(data.dates)
  const intro = array(data.intro)
  const introEditors = useEditorKeys(intro.length)
  const set = (key: string, next: JsonValue) => onChange({ ...data, [key]: next })
  const setDate = (key: string, next: string) => set('dates', { ...dates, [key]: next })
  return <div className="structured-form">
    <TextField label="实训营名称" path="title" value={text(data.title)} errors={errors} onChange={(next) => set('title', next)} />
    <div className="form-grid">
      <TextField label="开始日期" path="dates.start" type="date" value={text(dates.start)} errors={errors} onChange={(next) => setDate('start', next)} />
      <TextField label="结束日期" path="dates.end" type="date" value={text(dates.end)} errors={errors} onChange={(next) => setDate('end', next)} />
    </div>
    <TextField label="日期展示文字" path="dates.label" value={text(dates.label)} errors={errors} onChange={(next) => setDate('label', next)} />
    <TextField label="举办地点" path="venue" value={text(data.venue)} errors={errors} onChange={(next) => set('venue', next)} />
    <TextField label="首页标语" path="tagline" value={text(data.tagline)} errors={errors} onChange={(next) => set('tagline', next)} />
    <TextField label="招生对象" path="target" value={text(data.target)} errors={errors} onChange={(next) => set('target', next)} />
    {intro.map((item, index) => <fieldset key={introEditors.keys[index]}><legend>简介段落 {index + 1}</legend>
      <RichTextField label={`简介段落 ${index + 1}`} path={`intro.${index}`} value={text(item)} errors={errors} onChange={(next) => set('intro', intro.map((entry, itemIndex) => itemIndex === index ? next : entry))} />
      <CollectionActions label={`简介段落 ${index + 1}`} index={index} length={intro.length} onMove={(direction) => { introEditors.move(index, direction); set('intro', moveItem(intro, index, direction)) }} onDelete={() => { introEditors.remove(index); set('intro', intro.filter((_, itemIndex) => itemIndex !== index)) }} />
    </fieldset>)}
    <button type="button" className="button-secondary" onClick={() => { introEditors.append(); set('intro', [...intro, '<p></p>']) }}>添加简介段落</button>
  </div>
}

export function FeaturesForm({ value, errors, onChange }: FormProps) {
  const data = object(value)
  const items = array(data.items)
  const editors = useEditorKeys(items.length)
  const update = (next: JsonValue[]) => onChange({ ...data, items: next })
  return <div className="structured-form collection-list">{items.map((raw, index) => {
    const item = object(raw)
    const label = text(item.title)
    return <fieldset key={editors.keys[index]} data-testid="feature-item"><legend>特色 {index + 1}</legend>
      <TextField label="特色标题" path={`items.${index}.title`} value={label} errors={errors} onChange={(next) => update(items.map((entry, itemIndex) => itemIndex === index ? { ...object(entry), title: next } : entry))} />
      <RichTextField label="特色说明" path={`items.${index}.description`} value={text(item.description)} errors={errors} onChange={(next) => update(items.map((entry, itemIndex) => itemIndex === index ? { ...object(entry), description: next } : entry))} />
      <CollectionActions label={label || '特色'} index={index} length={items.length} onMove={(direction) => { editors.move(index, direction); update(moveItem(items, index, direction)) }} onDelete={() => { editors.remove(index); update(items.filter((_, itemIndex) => itemIndex !== index)) }} />
    </fieldset>
  })}<button type="button" className="button-secondary" onClick={() => { editors.append(); update([...items, { title: '', description: '' }]) }}>添加特色</button></div>
}

export function OrganizationsForm({ value, errors, onChange }: FormProps) {
  const data = object(value)
  const items = array(data.items)
  const editors = useEditorKeys(items.length)
  const update = (next: JsonValue[]) => onChange({ ...data, items: next })
  return <div className="structured-form collection-list">{items.map((raw, index) => {
    const item = object(raw)
    const label = text(item.name)
    return <fieldset key={editors.keys[index]}><legend>单位 {index + 1}</legend><div className="form-grid">
      <TextField label="单位类型" path={`items.${index}.role`} value={text(item.role)} errors={errors} onChange={(next) => update(items.map((entry, itemIndex) => itemIndex === index ? { ...object(entry), role: next } : entry))} />
      <TextField label="单位全称" path={`items.${index}.name`} value={label} errors={errors} onChange={(next) => update(items.map((entry, itemIndex) => itemIndex === index ? { ...object(entry), name: next } : entry))} />
    </div><CollectionActions label={label} index={index} length={items.length} onMove={(direction) => { editors.move(index, direction); update(moveItem(items, index, direction)) }} onDelete={() => { editors.remove(index); update(items.filter((_, itemIndex) => itemIndex !== index)) }} /></fieldset>
  })}<button type="button" className="button-secondary" onClick={() => { editors.append(); update([...items, { role: '', name: '' }]) }}>添加单位</button></div>
}

const dateKeyLabels = { registrationOpen: '报名开放', registrationDeadline: '报名截止', campStart: '实训开始', campEnd: '实训结束' }

export function ImportantDatesForm({ value, errors, onChange }: FormProps) {
  const data = object(value)
  const items = array(data.items)
  const editors = useEditorKeys(items.length)
  const update = (next: JsonValue[]) => onChange({ ...data, items: next })
  return <div className="structured-form collection-list">{items.map((raw, index) => {
    const item = object(raw)
    const label = text(item.label)
    const machinePath = `items.${index}.machineKey`
    return <fieldset key={editors.keys[index]}><legend>日期 {index + 1}</legend><div className="form-grid">
      <TextField label="事项" path={`items.${index}.label`} value={label} errors={errors} onChange={(next) => update(items.map((entry, itemIndex) => itemIndex === index ? { ...object(entry), label: next } : entry))} />
      <TextField label="日期或展示文字" path={`items.${index}.value`} type={text(item.machineKey) ? 'date' : 'text'} value={text(item.value)} errors={errors} onChange={(next) => update(items.map((entry, itemIndex) => itemIndex === index ? { ...object(entry), value: next } : entry))} />
      <div className="form-field"><label htmlFor={`date-key-${index}`}>日期用途</label><select id={`date-key-${index}`} value={text(item.machineKey)} aria-describedby={errorDescription(machinePath, errors)} aria-invalid={errors[machinePath] ? true : undefined} onChange={(event) => update(items.map((entry, itemIndex) => {
        if (itemIndex !== index) return entry
        const next = { ...object(entry) }
        if (event.target.value) next.machineKey = event.target.value
        else delete next.machineKey
        return next
      }))}><option value="">普通展示日期</option>{Object.entries(dateKeyLabels).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select><FieldError path={machinePath} errors={errors} /></div>
    </div><CollectionActions label={label} index={index} length={items.length} onMove={(direction) => { editors.move(index, direction); update(moveItem(items, index, direction)) }} onDelete={() => { editors.remove(index); update(items.filter((_, itemIndex) => itemIndex !== index)) }} /></fieldset>
  })}
  <FieldError path="items.registrationOpen" errors={errors} /><FieldError path="items.registrationDeadline" errors={errors} /><FieldError path="items.campStart" errors={errors} /><FieldError path="items.campEnd" errors={errors} />
  <button type="button" className="button-secondary" onClick={() => { editors.append(); update([...items, { label: '', value: '' }]) }}>添加重要日期</button></div>
}

export function TravelForm({ value, errors, onChange }: FormProps) {
  const data = object(value)
  const sections = array(data.sections)
  const editors = useEditorKeys(sections.length)
  const update = (next: JsonValue[]) => onChange({ ...data, sections: next })
  return <div className="structured-form collection-list">{sections.map((raw, index) => {
    const section = object(raw)
    const label = text(section.title)
    return <fieldset key={editors.keys[index]}><legend>交通住宿内容 {index + 1}</legend>
      <TextField label="小节标题" path={`sections.${index}.title`} value={label} errors={errors} onChange={(next) => update(sections.map((entry, itemIndex) => itemIndex === index ? { ...object(entry), title: next } : entry))} />
      <RichTextField label={`${label || '小节'}内容`} path={`sections.${index}.body`} value={text(section.body)} errors={errors} onChange={(next) => update(sections.map((entry, itemIndex) => itemIndex === index ? { ...object(entry), body: next } : entry))} />
      <CollectionActions label={label} index={index} length={sections.length} onMove={(direction) => { editors.move(index, direction); update(moveItem(sections, index, direction)) }} onDelete={() => { editors.remove(index); update(sections.filter((_, itemIndex) => itemIndex !== index)) }} />
    </fieldset>
  })}<button type="button" className="button-secondary" onClick={() => { editors.append(); update([...sections, { title: '', body: '' }]) }}>添加交通住宿小节</button></div>
}

type ContactEditorProps = {
  item: JsonObject
  index: number
  length: number
  errors: FieldErrors
  onChange: (item: JsonObject) => void
  onMove: (direction: -1 | 1) => void
  onDelete: () => void
}

function ContactEditor({ item, index, length, errors, onChange, onMove, onDelete }: ContactEditorProps) {
  const methods = array(item.methods)
  const methodEditors = useEditorKeys(methods.length)
  const label = text(item.name)
  const legacy = !label && text(item.label) !== ''
  const updateMethods = (next: JsonValue[]) => onChange({ ...item, methods: next })
  if (legacy) return <fieldset><legend>旧版联系人 {index + 1}</legend>
    <p className="legacy-warning">旧版联系人只能兼容展示，发布前请转换为结构化联系人。</p>
    <div className="form-grid">
      <TextField label="旧联系人标签" path={`items.${index}.label`} value={text(item.label)} errors={errors} onChange={(next) => onChange({ ...item, label: next })} />
      <TextField label="旧联系人内容" path={`items.${index}.value`} value={text(item.value)} errors={errors} onChange={(next) => onChange({ ...item, value: next })} />
      <TextField label="旧联系人链接" path={`items.${index}.href`} value={text(item.href)} errors={errors} onChange={(next) => onChange({ ...item, href: next })} />
    </div>
    <button type="button" className="button-secondary" onClick={() => onChange({ name: text(item.label), responsibility: '咨询', methods: [{ type: text(item.href).startsWith('tel:') ? 'phone' : 'email', value: text(item.value) }] })}>转换为结构化联系人</button>
    <CollectionActions label={text(item.label)} index={index} length={length} onMove={onMove} onDelete={onDelete} />
  </fieldset>
  return <fieldset><legend>联系人 {index + 1}</legend>
    <div className="form-grid">
      <TextField label="联系人姓名" path={`items.${index}.name`} value={label} errors={errors} onChange={(next) => onChange({ ...item, name: next })} />
      <TextField label="负责事项" path={`items.${index}.responsibility`} value={text(item.responsibility)} errors={errors} onChange={(next) => onChange({ ...item, responsibility: next })} />
    </div>
    <fieldset className="nested-fieldset"><legend>联系方式</legend>{methods.map((rawMethod, methodIndex) => {
      const method = object(rawMethod)
      const methodLabel = `联系方式 ${methodIndex + 1}`
      const methodPath = `items.${index}.methods.${methodIndex}`
      const updateMethod = (next: JsonObject) => updateMethods(methods.map((entry, itemIndex) => itemIndex === methodIndex ? next : entry))
      return <fieldset key={methodEditors.keys[methodIndex]}><legend>{methodLabel}</legend><div className="form-grid">
        <div className="form-field"><label htmlFor={`contact-type-${index}-${methodIndex}`}>联系人 {index + 1} 的{methodLabel} 类型</label><select id={`contact-type-${index}-${methodIndex}`} value={text(method.type) || 'email'} aria-describedby={errorDescription(`${methodPath}.type`, errors)} aria-invalid={errors[`${methodPath}.type`] ? true : undefined} onChange={(event) => updateMethod({ ...method, type: event.target.value })}><option value="email">邮箱</option><option value="phone">电话</option></select><FieldError path={`${methodPath}.type`} errors={errors} /></div>
        <TextField label={`联系人 ${index + 1} 的${methodLabel} 内容`} path={`${methodPath}.value`} type={method.type === 'phone' ? 'tel' : 'email'} value={text(method.value)} errors={errors} onChange={(next) => updateMethod({ ...method, value: next })} />
      </div><CollectionActions label={methodLabel} index={methodIndex} length={methods.length} onMove={(direction) => { methodEditors.move(methodIndex, direction); updateMethods(moveItem(methods, methodIndex, direction)) }} onDelete={() => { methodEditors.remove(methodIndex); updateMethods(methods.filter((_, itemIndex) => itemIndex !== methodIndex)) }} /></fieldset>
    })}<FieldError path={`items.${index}.methods`} errors={errors} /><button type="button" className="button-secondary" onClick={() => { methodEditors.append(); updateMethods([...methods, { type: 'email', value: '' }]) }}>添加联系方式</button></fieldset>
    <TextField label="咨询说明" path={`items.${index}.consultationNote`} value={text(item.consultationNote)} errors={errors} onChange={(next) => onChange({ ...item, consultationNote: next })} />
    <CollectionActions label={label || `联系人 ${index + 1}`} index={index} length={length} onMove={onMove} onDelete={onDelete} />
  </fieldset>
}

export function ContactsForm({ value, errors, onChange }: FormProps) {
  const data = object(value)
  const items = array(data.items)
  const editors = useEditorKeys(items.length)
  const update = (next: JsonValue[]) => onChange({ ...data, items: next })
  return <div className="structured-form collection-list">{items.map((raw, index) => <ContactEditor
    key={editors.keys[index]}
    item={object(raw)}
    index={index}
    length={items.length}
    errors={errors}
    onChange={(next) => update(items.map((entry, itemIndex) => itemIndex === index ? next : entry))}
    onMove={(direction) => { editors.move(index, direction); update(moveItem(items, index, direction)) }}
    onDelete={() => { editors.remove(index); update(items.filter((_, itemIndex) => itemIndex !== index)) }}
  />)}<FieldError path="items" errors={errors} /><button type="button" className="button-secondary" onClick={() => { editors.append(); update([...items, { name: '', responsibility: '', methods: [{ type: 'email', value: '' }] }]) }}>添加联系人</button></div>
}

const homeSectionLabels: Record<string, string> = { intro: '实训营简介', target: '面向对象', features: '实训特色', organizations: '组织单位' }

export function DisplayForm({ value, errors, onChange }: FormProps) {
  const data = object(value)
  const visible = array(data.visibleNavigation).map(String)
  const order = array(data.homeSectionOrder).map(String)
  const [sectionToAdd, setSectionToAdd] = useState('')
  const set = (key: string, next: JsonValue) => onChange({ ...data, [key]: next })
  return <div className="structured-form">
    <TextField label="系列名称" path="series" value={text(data.series)} errors={errors} onChange={(next) => set('series', next)} />
    <TextField label="页脚文字" path="footer" value={text(data.footer)} errors={errors} onChange={(next) => set('footer', next)} />
    <label className="check-field"><input type="checkbox" checked={data.showRegistrationCount === true} onChange={(event) => set('showRegistrationCount', event.target.checked)} />公开显示已提交报名人数</label>
    <fieldset><legend>公开导航</legend>{['home', 'schedule', 'register', 'travel', 'contacts', 'resources'].map((key) => <label className="check-field" key={key}><input type="checkbox" checked={visible.includes(key)} onChange={(event) => set('visibleNavigation', event.target.checked ? [...visible, key] : visible.filter((item) => item !== key))} />{key}</label>)}</fieldset>
    <fieldset><legend>首页模块顺序</legend>{order.map((sectionId, index) => <div key={sectionId} className="ordered-setting"><strong>{homeSectionLabels[sectionId] ?? sectionId}</strong><CollectionActions label={homeSectionLabels[sectionId] ?? sectionId} index={index} length={order.length} onMove={(direction) => set('homeSectionOrder', moveItem(order, index, direction))} onDelete={() => set('homeSectionOrder', order.filter((_, itemIndex) => itemIndex !== index))} /></div>)}
      <div className="form-grid"><div className="form-field"><label htmlFor="home-section-to-add">待添加首页模块</label><select id="home-section-to-add" value={sectionToAdd} aria-describedby={errorDescription('homeSectionOrder', errors)} aria-invalid={errors.homeSectionOrder ? true : undefined} onChange={(event) => setSectionToAdd(event.target.value)}><option value="">请选择</option>{Object.entries(homeSectionLabels).filter(([id]) => !order.includes(id)).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>
        <button type="button" className="button-secondary" disabled={!sectionToAdd} onClick={() => { if (!sectionToAdd || order.includes(sectionToAdd)) return; set('homeSectionOrder', [...order, sectionToAdd]); setSectionToAdd('') }}>添加首页模块</button></div>
      <FieldError path="homeSectionOrder" errors={errors} />
    </fieldset>
  </div>
}

type ScheduleSessionProps = {
  session: JsonObject
  sessionIndex: number
  sessionCount: number
  dayIndex: number
  speakers: JsonValue[]
  errors: FieldErrors
  onChange: (session: JsonObject) => void
  onMove: (direction: -1 | 1) => void
  onDelete: () => void
}

function ScheduleSessionEditor({ session, sessionIndex, sessionCount, dayIndex, speakers, errors, onChange, onMove, onDelete }: ScheduleSessionProps) {
  const range = object(session.timeRange)
  const details = array(session.details)
  const detailEditors = useEditorKeys(details.length)
  const sessionLabel = text(session.title)
  const base = `days.${dayIndex}.sessions.${sessionIndex}`
  return <fieldset className="nested-fieldset"><legend>课程 {sessionIndex + 1}</legend>
    <TextField label="课程主题" path={`${base}.title`} value={sessionLabel} errors={errors} onChange={(next) => onChange({ ...session, title: next })} />
    <TextField label="时间展示文字" path={`${base}.time`} value={text(session.time)} errors={errors} onChange={(next) => onChange({ ...session, time: next })} />
    <div className="form-grid">
      <TextField label="开始时间" type="time" path={`${base}.timeRange.start`} value={text(range.start)} errors={errors} onChange={(next) => onChange({ ...session, timeRange: { ...range, start: next } })} />
      <TextField label="结束时间" type="time" path={`${base}.timeRange.end`} value={text(range.end)} errors={errors} onChange={(next) => onChange({ ...session, timeRange: { ...range, end: next } })} />
    </div><FieldError path={`${base}.timeRange`} errors={errors} />
    <fieldset><legend>内容要点</legend>{details.map((detail, detailIndex) => <div key={detailEditors.keys[detailIndex]} className="ordered-setting">
      <TextField label={`课程 ${sessionIndex + 1} 的内容要点 ${detailIndex + 1}`} path={`${base}.details.${detailIndex}`} value={text(detail)} errors={errors} onChange={(next) => onChange({ ...session, details: details.map((entry, itemIndex) => itemIndex === detailIndex ? next : entry) })} />
      <CollectionActions label={`内容要点 ${detailIndex + 1}`} index={detailIndex} length={details.length} onMove={(direction) => { detailEditors.move(detailIndex, direction); onChange({ ...session, details: moveItem(details, detailIndex, direction) }) }} onDelete={() => { detailEditors.remove(detailIndex); onChange({ ...session, details: details.filter((_, itemIndex) => itemIndex !== detailIndex) }) }} />
    </div>)}<button type="button" className="button-secondary" onClick={() => { detailEditors.append(); onChange({ ...session, details: [...details, ''] }) }}>添加内容要点</button></fieldset>
    <div className="form-field"><label htmlFor={`speaker-${dayIndex}-${sessionIndex}`}>拟邀请讲师</label><select id={`speaker-${dayIndex}-${sessionIndex}`} multiple value={array(session.speakerIds).map(String)} aria-describedby={errorDescription(`${base}.speakerIds`, errors)} aria-invalid={errors[`${base}.speakerIds`] ? true : undefined} onChange={(event) => onChange({ ...session, speakerIds: Array.from(event.target.selectedOptions).map((option) => option.value) })}>{speakers.map((rawSpeaker) => { const speaker = object(rawSpeaker); return <option key={text(speaker.id)} value={text(speaker.id)}>{text(speaker.name)}</option> })}</select><FieldError path={`${base}.speakerIds`} errors={errors} /></div>
    {array(session.instructors).length > 0 ? <div className="legacy-warning"><p>该课程仍含旧版讲师文本，发布前请移除并改用讲师库。</p><FieldError path={`${base}.instructors`} errors={errors} /><button type="button" className="button-secondary" onClick={() => { const next = { ...session }; delete next.instructors; onChange(next) }}>移除旧讲师文本</button></div> : null}
    <CollectionActions label={sessionLabel || `课程 ${sessionIndex + 1}`} index={sessionIndex} length={sessionCount} onMove={onMove} onDelete={onDelete} />
  </fieldset>
}

type ScheduleDayProps = {
  day: JsonObject
  dayIndex: number
  dayCount: number
  speakers: JsonValue[]
  errors: FieldErrors
  onChange: (day: JsonObject) => void
  onMove: (direction: -1 | 1) => void
  onDelete: () => void
}

function ScheduleDayEditor({ day, dayIndex, dayCount, speakers, errors, onChange, onMove, onDelete }: ScheduleDayProps) {
  const sessions = array(day.sessions)
  const sessionEditors = useEditorKeys(sessions.length)
  const label = text(day.label)
  const updateSession = (sessionIndex: number, next: JsonObject) => onChange({ ...day, sessions: sessions.map((entry, itemIndex) => itemIndex === sessionIndex ? next : entry) })
  return <fieldset><legend>{label || `第 ${dayIndex + 1} 天`}</legend>
    <div className="form-grid">
      <TextField label="日期" type="date" path={`days.${dayIndex}.date`} value={text(day.date)} errors={errors} onChange={(next) => onChange({ ...day, date: next })} />
      <TextField label="日期标签" path={`days.${dayIndex}.label`} value={label} errors={errors} onChange={(next) => onChange({ ...day, label: next })} />
      <TextField label="当日主题" path={`days.${dayIndex}.theme`} value={text(day.theme)} errors={errors} onChange={(next) => onChange({ ...day, theme: next })} />
    </div>
    {sessions.map((rawSession, sessionIndex) => <ScheduleSessionEditor
      key={sessionEditors.keys[sessionIndex]}
      session={object(rawSession)}
      sessionIndex={sessionIndex}
      sessionCount={sessions.length}
      dayIndex={dayIndex}
      speakers={speakers}
      errors={errors}
      onChange={(next) => updateSession(sessionIndex, next)}
      onMove={(direction) => { sessionEditors.move(sessionIndex, direction); onChange({ ...day, sessions: moveItem(sessions, sessionIndex, direction) }) }}
      onDelete={() => { sessionEditors.remove(sessionIndex); onChange({ ...day, sessions: sessions.filter((_, itemIndex) => itemIndex !== sessionIndex) }) }}
    />)}
    <button type="button" className="button-secondary" onClick={() => { sessionEditors.append(); onChange({ ...day, sessions: [...sessions, { title: '', timeRange: { start: '', end: '' }, speakerIds: [] }] }) }}>添加课程</button>
    <CollectionActions label={label} index={dayIndex} length={dayCount} onMove={onMove} onDelete={onDelete} />
  </fieldset>
}

export function ScheduleForm({ value, errors, onChange }: FormProps) {
  const data = object(value)
  const speakers = array(data.speakers)
  const days = array(data.days)
  const speakerEditors = useEditorKeys(speakers.length)
  const dayEditors = useEditorKeys(days.length)
  const set = (key: string, next: JsonValue) => onChange({ ...data, [key]: next })
  return <div className="structured-form">
    <h3>讲师库</h3>{speakers.map((raw, index) => {
      const speaker = object(raw)
      const label = text(speaker.name)
      return <fieldset key={speakerEditors.keys[index]}><legend>讲师 {index + 1}</legend><div className="form-grid">
        <TextField label="讲师 ID" path={`speakers.${index}.id`} value={text(speaker.id)} errors={errors} onChange={(next) => set('speakers', speakers.map((entry, itemIndex) => itemIndex === index ? { ...object(entry), id: next } : entry))} />
        <TextField label="讲师姓名" path={`speakers.${index}.name`} value={label} errors={errors} onChange={(next) => set('speakers', speakers.map((entry, itemIndex) => itemIndex === index ? { ...object(entry), name: next } : entry))} />
      </div><CollectionActions label={label} index={index} length={speakers.length} onMove={(direction) => { speakerEditors.move(index, direction); set('speakers', moveItem(speakers, index, direction)) }} onDelete={() => { speakerEditors.remove(index); set('speakers', speakers.filter((_, itemIndex) => itemIndex !== index)) }} /></fieldset>
    })}<button type="button" className="button-secondary" onClick={() => { speakerEditors.append(); set('speakers', [...speakers, { id: '', name: '' }]) }}>添加讲师</button>
    <h3>日程</h3>{days.map((raw, dayIndex) => <ScheduleDayEditor
      key={dayEditors.keys[dayIndex]}
      day={object(raw)}
      dayIndex={dayIndex}
      dayCount={days.length}
      speakers={speakers}
      errors={errors}
      onChange={(next) => set('days', days.map((entry, itemIndex) => itemIndex === dayIndex ? next : entry))}
      onMove={(direction) => { dayEditors.move(dayIndex, direction); set('days', moveItem(days, dayIndex, direction)) }}
      onDelete={() => { dayEditors.remove(dayIndex); set('days', days.filter((_, itemIndex) => itemIndex !== dayIndex)) }}
    />)}<button type="button" className="button-secondary" onClick={() => { dayEditors.append(); set('days', [...days, { date: '', label: '', theme: '', sessions: [] }]) }}>添加日程日</button>
  </div>
}
