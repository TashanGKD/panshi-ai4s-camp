import { ContentSection } from '@panshi/ui'
import { PublicContentPayloadSchemas, type ContentModuleKey, type JsonObject } from '@panshi/contracts'
import { ContactPage } from '../pages/ContactPage'
import { HomePage } from '../pages/HomePage'
import { ScheduleContent } from '../pages/SchedulePage'
import { TravelContentView } from '../pages/TravelPage'
import { RichText } from '../components/RichText'

type ImportantDatesContentType = ReturnType<typeof PublicContentPayloadSchemas.importantDates.parse>

export function ImportantDatesContent({ importantDates }: { importantDates: ImportantDatesContentType }) {
  return <dl className="date-list">
    {importantDates.items.map((item) => <div key={`${item.machineKey ?? ''}:${item.label}:${item.value}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
  </dl>
}

export function ContentModuleRenderer({ moduleKey, payload }: { moduleKey: ContentModuleKey, payload: JsonObject }) {
  const content = PublicContentPayloadSchemas[moduleKey].parse(payload)
  switch (moduleKey) {
    case 'basic': return <HomePage basic={content as ReturnType<typeof PublicContentPayloadSchemas.basic.parse>} />
    case 'schedule': return <ScheduleContent schedule={content as ReturnType<typeof PublicContentPayloadSchemas.schedule.parse>} />
    case 'contacts': return <ContactPage contacts={content as ReturnType<typeof PublicContentPayloadSchemas.contacts.parse>} />
    case 'travel': {
      const travel = content as ReturnType<typeof PublicContentPayloadSchemas.travel.parse>
      return <section className="public-page__section"><h2>住宿交通</h2><TravelContentView travel={travel} /></section>
    }
    case 'importantDates': {
      const dates = content as ReturnType<typeof PublicContentPayloadSchemas.importantDates.parse>
      return <section className="public-page__section"><h2>重要日期</h2><ImportantDatesContent importantDates={dates} /></section>
    }
    case 'features': {
      const features = content as ReturnType<typeof PublicContentPayloadSchemas.features.parse>
      return <ContentSection title="实训特色"><div className="feature-list">{features.items.map((item) => <article key={item.title}><h3>{item.title}</h3><RichText as="p" html={item.description} /></article>)}</div></ContentSection>
    }
    case 'organizations': {
      const organizations = content as ReturnType<typeof PublicContentPayloadSchemas.organizations.parse>
      return <ContentSection title="组织单位"><dl className="organization-list">{organizations.items.map((item) => <div key={`${item.role}:${item.name}`}><dt>{item.role}</dt><dd>{item.name}</dd></div>)}</dl></ContentSection>
    }
    case 'display': return <section className="public-page__section"><h2>草稿展示设置</h2><p>展示设置请通过页面横幅和页脚查看。</p></section>
  }
}
