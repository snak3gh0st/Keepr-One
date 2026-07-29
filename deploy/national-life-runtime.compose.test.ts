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
})
