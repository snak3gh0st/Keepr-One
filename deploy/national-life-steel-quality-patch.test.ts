import { describe, expect, it } from 'vitest'
import { patchSteelScreencastQuality } from './national-life-steel-quality-patch.mjs'

describe('National Life Steel screencast-quality patch', () => {
  it('raises the reviewed JPEG screencast quality once', () => {
    const result = patchSteelScreencastQuality(
      'Page.startScreencast({ format: "jpeg", quality: 75, maxWidth, maxHeight })',
    )
    expect(result).toContain('quality: 92')
    expect(result).not.toContain('quality: 75')
  })

  it.each([
    'Page.startScreencast({ format: "jpeg", maxWidth, maxHeight })',
    'quality: 75; quality: 75',
  ])('rejects a missing or ambiguous reviewed Steel handler', (source) => {
    expect(() => patchSteelScreencastQuality(source)).toThrow(
      'Steel screencast quality did not match the reviewed Steel build',
    )
  })
})
