import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('National Life Steel runtime compose', () => {
  it('pins the public runtime router to the shared Coolify network', () => {
    const compose = readFileSync('deploy/national-life-runtime.compose.yaml', 'utf8')

    expect(compose).toContain('traefik.docker.network=coolify')
  })

  it('gives the private CDP proxy writable temporary storage under read-only rootfs', () => {
    const compose = readFileSync('deploy/national-life-runtime.compose.yaml', 'utf8')

    expect(compose).toContain('/var/lib/nginx:rw,noexec,nosuid,size=64m')
    expect(compose).toContain('access_log off;')
  })

  it('matches the private Xvfb display to the 1600 by 1000 interactive browser', () => {
    const compose = readFileSync('deploy/national-life-runtime.compose.yaml', 'utf8')

    expect(compose).toContain('Xvfb :10 -screen 0 1600x1000x24')
    expect(compose).not.toContain('Xvfb :10 -screen 0 1280x800x24')
  })

  it('allows the observed National Life MFA and Auth0 login origins exactly', () => {
    const compose = readFileSync('deploy/national-life-runtime.compose.yaml', 'utf8')

    expect(compose).toContain(
      'NATIONAL_LIFE_PORTAL_ORIGINS: https://www.nationallife.com,https://nlg-prod.auth0.com,https://nlg-prod.us.auth0.com,https://mfa.nationallife.com,https://federate.ipipeline.com',
    )
  })
})
