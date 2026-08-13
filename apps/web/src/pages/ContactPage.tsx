import type { ContactsContent } from '@panshi/contracts'

export function ContactPage({ contacts }: { contacts: ContactsContent }) {
  return <section className="public-page__section"><h2>联系我们</h2>
    {contacts.items.length === 0 ? <p>联系信息尚未发布</p> : <dl className="contact-list">{contacts.items.map((item) => <div key={`${item.label}:${item.value}`}><dt>{item.label}</dt><dd>{item.href ? <a href={item.href}>{item.value}</a> : item.value}</dd></div>)}</dl>}
  </section>
}
