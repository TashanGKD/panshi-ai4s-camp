import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesheet = await readFile(join(process.cwd(), 'src/styles/public.css'), 'utf8')

const ruleFor = (selector: string) => stylesheet.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*\\{([^}]+)\\}`, 'u'))?.[1] ?? ''

describe('public editorial styles', () => {
  it('keeps feature entries as plain text without decorative card borders', () => {
    const rule = ruleFor('.feature-list article')
    expect(rule).not.toContain('border-left')
    expect(rule).not.toContain('border-bottom')
    expect(rule).not.toContain('background')
  })

  it('bottom-aligns each guest name with the adjacent two-line identity block', () => {
    expect(ruleFor('.guest-profile__identity h3')).toContain('align-self: end')
  })

  it('sets compact two-line guest metadata below the top of the name on desktop', () => {
    const identity = ruleFor('.guest-profile__identity')
    const metadata = ruleFor('.guest-profile__identity p')
    expect(identity).toContain('gap: 0 12px')
    expect(metadata).toContain('font-size: 12px')
    expect(metadata).toContain('line-height: 1.2')
  })
})
