import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('iGO extension boundary', () => {
  it('grants only the exact iPipeline hosts used by the authenticated handoff', () => {
    const source = readFileSync(new URL('../wxt.config.ts', import.meta.url), 'utf8')
    for (const pattern of [
      'https://pipepasstoigo.ipipeline.com/*',
      'https://federate.ipipeline.com/*',
      'https://igoforms2.ipipeline.com/*',
    ]) expect(source).toContain(pattern)
    expect(source).not.toContain('https://*.ipipeline.com/*')
  })
})
