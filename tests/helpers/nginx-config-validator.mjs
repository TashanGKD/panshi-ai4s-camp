import assert from 'node:assert/strict'

const findClosingBrace = (source, openIndex, label) => {
  let comment = false
  let depth = 1
  let quote = ''
  for (let index = openIndex + 1; index < source.length; index += 1) {
    const character = source[index]
    if (comment) {
      if (character === '\n') comment = false
      continue
    }
    if (quote) {
      if (character === quote && source[index - 1] !== '\\') quote = ''
    } else if (character === '#') {
      comment = true
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '{') {
      depth += 1
    } else if (character === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  assert.fail(`unbalanced block for ${label}`)
}

export const extractBlocks = (source, keyword) => {
  const blocks = new Map()
  const pattern = new RegExp(`(?:^|\\n)\\s*${keyword}\\s+([^\\n{]+)\\s*\\{`, 'gu')
  for (const match of source.matchAll(pattern)) {
    const openIndex = match.index + match[0].lastIndexOf('{')
    const selector = match[1].trim()
    const closeIndex = findClosingBrace(source, openIndex, `${keyword} ${selector}`)
    assert.ok(!blocks.has(selector), `duplicate ${keyword} block for ${selector}`)
    blocks.set(selector, source.slice(openIndex + 1, closeIndex))
  }
  return blocks
}

const extractSingleBlock = (source, keyword) => {
  const pattern = new RegExp(`(?:^|\\n)\\s*${keyword}\\s*\\{`, 'gu')
  const matches = [...source.matchAll(pattern)]
  assert.equal(matches.length, 1, `Nginx must define exactly one ${keyword} block`)
  const match = matches[0]
  const openIndex = match.index + match[0].lastIndexOf('{')
  const closeIndex = findClosingBrace(source, openIndex, keyword)
  return source.slice(openIndex + 1, closeIndex)
}

const parseDirectives = (block, selector, { allowLocationBlocks = false } = {}) => {
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
    } else if (character === '{') {
      if (!allowLocationBlocks) assert.fail(`nested content handler in critical location ${selector}`)
      const nestedHeader = buffer.trim()
      assert.match(nestedHeader, /^location\s+[^{}]+$/u, `unexpected nested block in ${selector}`)
      buffer = ''
      index = findClosingBrace(block, index, nestedHeader)
    } else if (character === '}') {
      assert.fail(`unmatched closing brace in ${selector}`)
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

const serializedDirectives = (block, selector, options) => parseDirectives(block, selector, options)
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
  const server = extractSingleBlock(nginx, 'server')
  assert.deepEqual(
    serializedDirectives(server, 'server', { allowLocationBlocks: true }),
    [
      'add_header Content-Security-Policy "default-src \'self\'; base-uri \'self\'; object-src \'none\'; frame-ancestors \'none\'; form-action \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: https:; font-src \'self\' data:; connect-src \'self\'" always',
      'add_header Referrer-Policy "strict-origin-when-cross-origin" always',
      'add_header X-Content-Type-Options "nosniff" always',
      'add_header X-Frame-Options "DENY" always',
      'index index.html',
      'listen 8080',
      'root /usr/share/nginx/html',
    ].sort(),
    'server block contains missing, duplicate, or unexpected direct directives',
  )
  const locations = extractBlocks(nginx, 'location')
  const allowedSelectors = ['= /healthz', '= /uploads', '^~ /uploads/', '/api/', '= /admin', '^~ /admin/', '/']
  assert.deepEqual(
    [...locations.keys()].sort(),
    [...allowedSelectors].sort(),
    'Nginx location selectors must exactly match the production routing contract',
  )
  assertExactDirectives(locations, '/api/', [
    'proxy_pass http://api:3001',
    'proxy_http_version 1.1',
    'proxy_set_header Host $host',
    'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for',
    'proxy_set_header X-Forwarded-Proto $panshi_forwarded_proto',
    'proxy_set_header X-Real-IP $remote_addr',
  ])
  assertExactDirectives(locations, '= /healthz', [
    'access_log off',
    'default_type text/plain',
    'return 200 "ok\\n"',
  ])
  assertExactDirectives(locations, '= /admin', ['return 308 /admin/'])
  assertExactDirectives(locations, '^~ /admin/', ['try_files $uri $uri/ /admin/index.html'])
  assertExactDirectives(locations, '/', ['try_files $uri $uri/ /index.html'])
  assertExactDirectives(locations, '= /uploads', ['return 404'])
  assertExactDirectives(locations, '^~ /uploads/', ['return 404'])
  assert.doesNotMatch(nginx, /(?:alias|root)\s+[^;]*uploads/iu, 'Nginx must never map the private uploads directory')
}
