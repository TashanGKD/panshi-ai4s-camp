import assert from 'node:assert/strict'

export const extractBlocks = (source, keyword) => {
  const blocks = new Map()
  const pattern = new RegExp(`(?:^|\\n)\\s*${keyword}\\s+([^\\n{]+)\\s*\\{`, 'gu')
  for (const match of source.matchAll(pattern)) {
    const openIndex = match.index + match[0].lastIndexOf('{')
    let depth = 1
    let quote = ''
    let closeIndex = openIndex + 1
    for (; closeIndex < source.length && depth > 0; closeIndex += 1) {
      const character = source[closeIndex]
      if (quote) {
        if (character === quote && source[closeIndex - 1] !== '\\') quote = ''
      } else if (character === '"' || character === "'") {
        quote = character
      } else if (character === '{') {
        depth += 1
      } else if (character === '}') {
        depth -= 1
      }
    }
    assert.equal(depth, 0, `unbalanced ${keyword} block for ${match[1].trim()}`)
    const selector = match[1].trim()
    assert.ok(!blocks.has(selector), `duplicate ${keyword} block for ${selector}`)
    blocks.set(selector, source.slice(openIndex + 1, closeIndex - 1))
  }
  return blocks
}

const parseDirectives = (block, selector) => {
  const parsed = []
  let buffer = ''
  let comment = false
  let quote = ''

  for (let index = 0; index < block.length; index += 1) {
    const character = block[index]
    if (comment) {
      if (character === '\n') comment = false
      continue
    }
    if (quote) {
      buffer += character
      if (character === quote && block[index - 1] !== '\\') quote = ''
      continue
    }
    if (character === '#') {
      comment = true
    } else if (character === '"' || character === "'") {
      quote = character
      buffer += character
    } else if (character === '{' || character === '}') {
      assert.fail(`nested content handler in critical location ${selector}`)
    } else if (character === ';') {
      const directive = buffer.trim()
      assert.notEqual(directive, '', `empty directive in critical location ${selector}`)
      const separator = directive.search(/\s/u)
      parsed.push(separator === -1
        ? { name: directive, value: '' }
        : { name: directive.slice(0, separator), value: directive.slice(separator).trim() })
      buffer = ''
    } else {
      buffer += character
    }
  }

  assert.equal(quote, '', `unterminated quote in critical location ${selector}`)
  assert.equal(buffer.trim(), '', `unterminated directive in critical location ${selector}`)
  return parsed
}

const serializedDirectives = (block, selector) => parseDirectives(block, selector)
  .map(({ name, value }) => `${name}${value === '' ? '' : ` ${value}`}`)
  .sort()

const assertExactDirectives = (locations, selector, expected) => {
  const block = locations.get(selector)
  assert.ok(block !== undefined, `Nginx must define location ${selector}`)
  assert.deepEqual(
    serializedDirectives(block, selector),
    [...expected].sort(),
    `critical location ${selector} contains missing, duplicate, or unexpected directives`,
  )
}

export const validateCriticalNginxConfig = (nginx) => {
  const locations = extractBlocks(nginx, 'location')
  for (const selector of ['= /healthz', '= /uploads', '^~ /uploads/', '/api/', '= /admin', '^~ /admin/', '/']) {
    assert.ok(locations.has(selector), `Nginx must define location ${selector}`)
  }
  assertExactDirectives(locations, '/api/', [
    'proxy_pass http://api:3001',
    'proxy_http_version 1.1',
    'proxy_set_header Host $host',
    'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for',
    'proxy_set_header X-Forwarded-Proto $scheme',
    'proxy_set_header X-Real-IP $remote_addr',
  ])
  assertExactDirectives(locations, '= /admin', ['return 308 /admin/'])
  assertExactDirectives(locations, '^~ /admin/', ['try_files $uri $uri/ /admin/index.html'])
  assertExactDirectives(locations, '/', ['try_files $uri $uri/ /index.html'])
  assertExactDirectives(locations, '= /uploads', ['return 404'])
  assertExactDirectives(locations, '^~ /uploads/', ['return 404'])
  assert.doesNotMatch(nginx, /(?:alias|root)\s+[^;]*uploads/iu, 'Nginx must never map the private uploads directory')
}
