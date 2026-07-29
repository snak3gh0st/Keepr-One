import { describe, expect, it } from 'vitest'
import { patchSteelScreencastQuality } from './national-life-steel-quality-patch.mjs'

const reviewedScreencastCall = `await targetClient.send("Page.startScreencast", {
                    format: "jpeg",
                    quality: 75,
                    maxWidth: width,
                    maxHeight: height,
                });`

const patchedScreencastCall = `await targetClient.send("Page.startScreencast", {
                    format: "jpeg",
                    quality: 92,
                    maxWidth: width,
                    maxHeight: height,
                });`

describe('National Life Steel screencast-quality patch', () => {
  it('raises only the exact reviewed Page.startScreencast JPEG quality', () => {
    const source = `${reviewedScreencastCall}
const unrelatedThumbnail = { quality: 75 }`

    const result = patchSteelScreencastQuality(source)

    expect(result).toContain(patchedScreencastCall)
    expect(result).toContain('const unrelatedThumbnail = { quality: 75 }')
  })

  it.each([
    'const unrelatedThumbnail = { quality: 75 }',
    `await targetClient.send("Page.startScreencast", {
                    format: "jpeg",
                    quality: 80,
                    maxWidth: width,
                    maxHeight: height,
                });
const unrelatedThumbnail = { quality: 75 }`,
    `${reviewedScreencastCall}
${reviewedScreencastCall}`,
    `${reviewedScreencastCall}
await targetClient.send("Page.startScreencast", {
                    format: "jpeg",
                    quality: 80,
                    maxWidth: width,
                    maxHeight: height,
                });`,
  ])('rejects an absent, changed, or ambiguous reviewed screencast call', (source) => {
    expect(() => patchSteelScreencastQuality(source)).toThrow(
      'Steel screencast quality did not match the reviewed Steel build',
    )
  })
})
