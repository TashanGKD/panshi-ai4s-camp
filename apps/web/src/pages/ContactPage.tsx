import type { ContactsContent } from '@panshi/contracts'

export function ContactList({ contacts }: { contacts: ContactsContent }) {
  type ContactItem = ContactsContent['items'][number]
  type StructuredContact = Extract<ContactItem, { name: string }>
  type LegacyContact = Extract<ContactItem, { label: string }>
  const structured = contacts.items.filter((item): item is StructuredContact => 'name' in item)
  const legacy = contacts.items.filter((item): item is LegacyContact => !('name' in item))
  const groups = structured.reduce<[string, StructuredContact[]][]>((result, item) => {
    const group = result.find(([responsibility]) => responsibility === item.responsibility)
    if (group) group[1].push(item)
    else result.push([item.responsibility, [item]])
    return result
  }, [])
  return <div className="contact-list">
    {groups.map(([responsibility, items]) => <section className="contact-group" key={responsibility}>
      <h3>{responsibility}</h3>
      <ul>{items.map((item) => <li key={`${item.name}:${item.responsibility}`}><strong>{item.name}</strong>
        {item.methods.map((method) => <span key={`${method.type}:${method.value}`}><a href={`${method.type === 'phone' ? 'tel' : 'mailto'}:${method.value}`}>{method.value}</a></span>)}
        {item.consultationNote ? <small>{item.consultationNote}</small> : null}
      </li>)}</ul>
    </section>)}
    {legacy.length > 0 ? <dl>{legacy.map((item) => <div key={`${item.label}:${item.value}`}><dt>{item.label}</dt><dd>{item.href ? <a href={item.href}>{item.value}</a> : item.value}</dd></div>)}</dl> : null}
  </div>
}

export function ContactPage({ contacts }: { contacts: ContactsContent }) {
  return <section className="public-page__section"><h2>联系我们</h2>
    {contacts.items.length === 0 ? <p>联系信息尚未发布</p> : <ContactList contacts={contacts} />}
  </section>
}
