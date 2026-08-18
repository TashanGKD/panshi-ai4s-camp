import { describe, expect, it, vi } from 'vitest'
import { createOutput } from './output.js'

describe('CLI output', () => {
  it('writes exactly one JSON document to stdout and progress to stderr', () => {
    const stdout = vi.fn(); const stderr = vi.fn(); const output = createOutput({ json: true, stdout, stderr })
    output.progress('loading'); output.success({ ok: true, apiVersion: 'v1', capabilityId: 'public.site.show', data: {}, requestId: 'local' })
    expect(stdout).toHaveBeenCalledTimes(1)
    expect(stdout.mock.calls[0]?.[0]).toBe('{"ok":true,"apiVersion":"v1","capabilityId":"public.site.show","data":{},"requestId":"local"}\n')
    expect(stderr).toHaveBeenCalledWith('loading\n')
    expect(stdout.mock.calls[0]?.[0]).not.toMatch(/\u001b\[/u)
  })
})
