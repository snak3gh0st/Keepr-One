import { describe, expect, it } from 'vitest'
import { patchSteelTargetResilience } from './national-life-steel-resilience-patch.mjs'

const reviewedApplyMetricsCall = `                await this.applyDeviceMetricsOverride(page);`

const patchedApplyMetricsCall = `                try {
                    await this.applyDeviceMetricsOverride(page);
                }
                catch (error) {
                    this.logger.warn({ error }, "[CDPService] Target closed while applying device metrics; skipping target setup");
                    return;
                }`

describe('National Life Steel target resilience patch', () => {
  it('contains a closed-target rejection inside new-target instrumentation', () => {
    const source = `async handleNewTarget(target) {
        if (target.type() === TargetType.PAGE) {
${reviewedApplyMetricsCall}
                await this.injectFingerprintSafely(page, this.fingerprintData);
        }
    }`

    const result = patchSteelTargetResilience(source)

    expect(result).toContain(patchedApplyMetricsCall)
    expect(result).toContain('await this.injectFingerprintSafely(page, this.fingerprintData);')
  })

  it.each([
    'const unrelated = true',
    `                await this.applyDeviceMetricsOverride(page);
                await this.applyDeviceMetricsOverride(page);`,
    `                await this.applyDeviceMetricsOverride(other);`,
  ])('rejects an absent, ambiguous, or changed reviewed call', (source) => {
    expect(() => patchSteelTargetResilience(source)).toThrow(
      'Steel target resilience did not match the reviewed Steel build',
    )
  })
})
