import type { ContactsContent } from '@panshi/contracts'

export function ContactList({ contacts }: { contacts: ContactsContent }) {
  return <dl className="contact-list">{contacts.items.map((item) => {
    if ('name' in item) {
      return <div key={`${item.name}:${item.responsibility}`}>
        <dt>{item.name}</dt>
        <dd><p>{item.responsibility}</p>
          <ul>{item.methods.map((method) => <li key={`${method.type}:${method.value}`}>
            <a href={`${method.type === 'phone' ? 'tel' : 'mailto'}:${method.value}`}>{method.value}</a>
          </li>)}</ul>
          {item.consultationNote ? <p>{item.consultationNote}</p> : null}
        </dd>
      </div>
    }
    return <div key={`${item.label}:${item.value}`}><dt>{item.label}</dt><dd>{item.href ? <a href={item.href}>{item.value}</a> : item.value}</dd></div>
  })}</dl>
}

export function ContactPage({ contacts }: { contacts: ContactsContent }) {
  return <section className="public-page__section"><h2>联系我们</h2>
    {contacts.items.length === 0 ? <p>联系信息尚未发布</p> : <ContactList contacts={contacts} />}
  </section>
}
