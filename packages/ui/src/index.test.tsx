import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EventBanner } from './index.js'

describe('shared UI package', () => {
  it('renders the exported event banner', () => {
    const markup = renderToStaticMarkup(<EventBanner title="实训营" dates="2026年8月" venue="物理所" />)
    expect(markup).toContain('实训营')
    expect(markup).toContain('2026年8月')
    expect(markup).toContain('物理所')
  })
})
