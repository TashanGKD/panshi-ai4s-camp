import { describe, expect, it } from 'vitest'
import { sanitizeContentPayload } from '../src/modules/content/content-sanitizer.js'
import { validateContentForPublication } from '../src/modules/content/content.validators.js'

const repository = { findPublishedPayload: async () => null }

describe('content rich-text security boundary', () => {
  it('keeps the formatting allowlist and strips executable markup', () => {
    const payload = sanitizeContentPayload('travel', { sections: [{
      title: '路线',
      body: '<p onclick="bad()"><strong>地铁</strong></p><script>alert(1)</script><iframe src="https://evil.example"></iframe><a href="javascript:bad()">链接</a>',
    }] })
    expect(payload).toEqual({ sections: [{ title: '路线', body: '<p><strong>地铁</strong></p><a>链接</a>' }] })
    expect(JSON.stringify(payload)).not.toMatch(/script|iframe|onclick|javascript:/iu)
  })

  it('rejects unsanitized rich text at publish and rollback validation boundaries', async () => {
    await expect(validateContentForPublication('features', {
      items: [{ title: '特色', description: '<p onmouseover="bad()">说明</p>' }],
    }, repository)).rejects.toMatchObject({
      details: { fields: expect.arrayContaining([expect.objectContaining({ path: 'payload', code: 'UNSAFE_HTML' })]) },
    })
  })
})
