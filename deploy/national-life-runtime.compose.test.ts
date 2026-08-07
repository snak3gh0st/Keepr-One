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

  it('documents the observed National Life MFA and Auth0 origins in the env example', () => {
    const envExample = readFileSync('.env.example', 'utf8')

    expect(envExample).toContain(
      'NATIONAL_LIFE_PORTAL_ORIGINS="https://www.nationallife.com,https://nlg-prod.auth0.com,https://nlg-prod.us.auth0.com,https://mfa.nationallife.com"',
    )
  })

  it('monta o mesmo volume de uploads que o container da app usa', () => {
    const compose = readFileSync('deploy/national-life-runtime.compose.yaml', 'utf8')

    // Quem escreve o PDF do Foresight é este runtime; quem serve o download é a
    // app. Sem esta montagem o arquivo vai para um disco efêmero dentro do
    // runtime, a linha do banco aponta para ele, e todo download dá 404 — em
    // silêncio, e sem que nenhum teste unitário possa ver, porque eles
    // exercitam um sistema de arquivos só.
    expect(compose).toContain('UPLOADS_DIR: /data/uploads')
    expect(compose).toContain('- fyntra_uploads:/data/uploads')
    // `external` importa: sem isso o Docker cria um volume novo com nome
    // derivado do projeto, e os dois containers escrevem em discos diferentes
    // acreditando compartilhar um.
    expect(compose).toMatch(/fyntra_uploads:\n\s+external: true\n\s+name: sbdvgmwn1l8r3te8kef2z88k-fyntra_uploads/)
  })
})
