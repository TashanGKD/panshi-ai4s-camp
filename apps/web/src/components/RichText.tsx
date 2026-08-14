export function RichText({ as: Element = 'div', html, className }: { as?: 'div' | 'p', html: string, className?: string }) {
  // The API sanitizes rich text on draft save and sanitizes legacy published payloads before returning them.
  if (Element === 'p' && /<(?:p|ul|ol)(?:\s|>)/iu.test(html)) {
    return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
  }
  return <Element className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
