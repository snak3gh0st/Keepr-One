import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const dockerfile = readFileSync('Dockerfile.national-life-runtime', 'utf8')

describe('National Life runtime image', () => {
  // Listing scripts one by one went wrong four times. Each time the script was
  // absent from the image, failed at runtime with MODULE_NOT_FOUND, ran only
  // because somebody copied it into the container by hand, and disappeared
  // again the next time the container was recreated.
  it('ships every National Life script rather than a hand-kept list', () => {
    const shipped = readdirSync('scripts').filter(
      (name) => name.startsWith('national-life-') && name.endsWith('.ts') && !name.includes('.test.'),
    )

    expect(shipped.length).toBeGreaterThan(10)
    expect(dockerfile).toContain('COPY scripts/national-life-*.ts ./scripts/')

    for (const name of shipped) {
      expect(
        dockerfile.includes('COPY scripts/national-life-*.ts') ||
          dockerfile.includes(`COPY scripts/${name}`),
      ).toBe(true)
    }
  })

  it('starts the worker rather than a one-off script', () => {
    expect(dockerfile).toContain('CMD ["pnpm", "worker:national-life"]')
  })
})
