import { describe, expect, it } from 'vitest'
import {
  describeIllustrationDelivery,
  illustrationPdfMessage,
  latestPdfStatusByIllustration,
} from './illustration-pdf-status'
import type { BrowserJobRecord } from './job-service'

function job(patch: Partial<BrowserJobRecord>): BrowserJobRecord {
  return {
    id: 'job-1',
    agentId: 'agent-1',
    caseId: null,
    provider: 'NATIONAL_LIFE',
    operation: 'GENERATE_ILLUSTRATION_PDF',
    state: 'FAILED',
    idempotencyKey: 'k',
    input: { illustrationId: 'ill-1' },
    result: null,
    safeErrorCode: null,
    safeErrorDetail: null,
    attemptCount: 1,
    availableAt: new Date('2026-07-31T15:00:00Z'),
    leaseOwner: null,
    leaseExpiresAt: null,
    ...patch,
  } as BrowserJobRecord
}

describe('latestPdfStatusByIllustration', () => {
  it('reports a queued render as still working', () => {
    expect(latestPdfStatusByIllustration([job({ state: 'QUEUED' })]).get('ill-1')).toEqual({
      state: 'WORKING',
    })
  })

  // The worker will pick it up again on its own. Calling that a failure sends
  // the agent to press a button the queue is about to press for them.
  it('treats a retryable render as still working', () => {
    expect(latestPdfStatusByIllustration([job({ state: 'RETRYABLE' })]).get('ill-1')).toEqual({
      state: 'WORKING',
    })
  })

  it('carries the failure code through, since that is what names the fix', () => {
    const status = latestPdfStatusByIllustration([
      job({ state: 'FAILED', safeErrorCode: 'FORESIGHT_SSO_EXPIRED' }),
    ])
    expect(status.get('ill-1')).toEqual({
      state: 'FAILED',
      safeErrorCode: 'FORESIGHT_SSO_EXPIRED',
    })
  })

  // Asking again after a failure is the normal recovery, so the newest attempt
  // has to win — otherwise the row keeps showing yesterday's error while the
  // carrier is rendering right now.
  it('keeps only the newest attempt per illustration', () => {
    const status = latestPdfStatusByIllustration([
      job({ id: 'new', state: 'RUNNING' }),
      job({ id: 'old', state: 'FAILED', safeErrorCode: 'FORESIGHT_SSO_EXPIRED' }),
    ])
    expect(status.get('ill-1')).toEqual({ state: 'WORKING' })
  })

  // The row already shows the PDF link in that case; a second signal saying
  // "pronto" next to it would be noise.
  it('says nothing about a render that succeeded', () => {
    expect(latestPdfStatusByIllustration([job({ state: 'SUCCEEDED' })]).size).toBe(0)
  })

  it('ignores jobs whose input carries no illustration', () => {
    expect(latestPdfStatusByIllustration([job({ input: {} as never })]).size).toBe(0)
  })
})

describe('illustrationPdfMessage', () => {
  it('does not call an unclaimed connector command a running Foresight render', () => {
    const status = { state: 'WAITING_FOR_KBOT' } as never

    expect(describeIllustrationDelivery({ documentReady: false, status })).toEqual({
      eyebrow: 'K-Bot · conexão necessária',
      title: 'Reconecte o K-Bot para iniciar',
      detail: 'O pedido oficial está salvo. Reconecte o K-Bot neste computador para ele abrir o Foresight e continuar a mesma ilustração.',
    })
    expect(illustrationPdfMessage(status)).toBe(
      'K-Bot está aguardando conexão neste computador para iniciar o mesmo pedido.',
    )
  })

  it('never presents an uploaded PDF as verified when its Term reconciliation failed', () => {
    expect(describeIllustrationDelivery({
      documentReady: true,
      status: { state: 'FAILED', safeErrorCode: 'FORESIGHT_TERM_PREMIUM_MISSING' },
    })).toEqual({
      eyebrow: 'Revisão necessária',
      title: 'Não foi possível conferir o PDF Term',
      detail: 'O PDF Term foi recebido, mas os prêmios não puderam ser conferidos. Tente conferir este PDF novamente; se persistir, gere uma nova ilustração.',
    })
  })

  it('does not mask a generic reconciliation failure behind an uploaded file', () => {
    expect(describeIllustrationDelivery({
      documentReady: true,
      verified: false,
      status: { state: 'FAILED', safeErrorCode: 'DEVICE_REQUEST_FAILED' },
    })).toEqual({
      eyebrow: 'Revisão necessária',
      title: 'O PDF foi recebido, mas a conferência não terminou',
      detail: 'O arquivo foi recebido, mas o K-Bot não concluiu a conferência do resultado. Nenhum valor foi aceito como oficial. Não foi possível gerar (DEVICE_REQUEST_FAILED).',
    })
  })

  // The measured failure of 2026-07-31 15:38 UTC. Nothing is wrong with the
  // quote — the carrier's tool wants a login — and the sentence has to say so,
  // or the agent goes looking in the wrong place.
  it('turns the expired carrier login into an instruction, not an error', () => {
    expect(
      illustrationPdfMessage({ state: 'FAILED', safeErrorCode: 'FORESIGHT_SSO_EXPIRED' }),
    ).toBe('A seguradora pediu login novo. Reconecte a integração e peça de novo.')
  })

  it('shows an unmapped code rather than swallowing it', () => {
    expect(illustrationPdfMessage({ state: 'FAILED', safeErrorCode: 'WAT' })).toBe(
      'Não foi possível gerar (WAT).',
    )
  })

  it('explains that Foresight rejected the entered premium without pretending a PDF is still running', () => {
    expect(
      illustrationPdfMessage({ state: 'FAILED', safeErrorCode: 'FORESIGHT_PREMIUM_WRITE_MISMATCH' }),
    ).toBe(
      'O Foresight não aceitou o prêmio mensal informado para este cenário. Revise o prêmio e gere uma nova ilustração; nenhum PDF foi emitido.',
    )
    expect(describeIllustrationDelivery({
      documentReady: false,
      status: { state: 'FAILED', safeErrorCode: 'FORESIGHT_PREMIUM_WRITE_MISMATCH' },
    })).toEqual({
      eyebrow: 'Revisão necessária',
      title: 'O Foresight não aceitou este cenário',
      detail: 'O Foresight não aceitou o prêmio mensal informado para este cenário. Revise o prêmio e gere uma nova ilustração; nenhum PDF foi emitido.',
    })
  })

  it('explains a carrier calculation failure without exposing connector internals', () => {
    expect(
      illustrationPdfMessage({ state: 'FAILED', safeErrorCode: 'FORESIGHT_CALCULATION_UNAVAILABLE' }),
    ).toBe(
      'O Foresight não conseguiu calcular um cenário válido com esse valor de origem. Revise o capital ou prêmio e gere uma nova ilustração; nenhum PDF foi emitido.',
    )
  })

  it('turns a rejected client form into a retryable explanation without exposing connector internals', () => {
    expect(
      illustrationPdfMessage({ state: 'FAILED', safeErrorCode: 'FORESIGHT_CLIENT_READBACK_TIMEOUT' }),
    ).toBe(
      'O Foresight não confirmou os dados do segurado. Revise nascimento, estado e perfil de risco antes de tentar novamente; nenhum PDF foi emitido.',
    )
    expect(
      illustrationPdfMessage({ state: 'FAILED', safeErrorCode: 'FORESIGHT_TERM_CLIENT_NAME_WRITE_MISMATCH' }),
    ).toBe(
      'O Foresight não confirmou uma etapa do cadastro Term após uma repetição segura. Nenhum PDF foi emitido e o K-Bot não continuará tentando sozinho.',
    )
  })

  it('does not print an empty parenthesis when there is no code', () => {
    expect(illustrationPdfMessage({ state: 'FAILED', safeErrorCode: null })).toBe(
      'Não foi possível gerar.',
    )
  })

  // The range comes from measuring a real illustration opening at the
  // carrier: minutes, not seconds. Without it, silence reads as broken.
  it('says how long a render in flight usually takes', () => {
    expect(illustrationPdfMessage({ state: 'WORKING' })).toBe(
      'K-Bot está fazendo no Foresight o que você faria: preenchendo o cenário, aguardando o cálculo e preparando o PDF. Estimativa típica: 2–5 minutos.',
    )
  })

  // ACTION_REQUIRED means a human has to connect. Reporting it as "gerando" is
  // the silence that made the integration read as broken on 2026-07-31.
  it('tells the agent when a render is waiting on them', () => {
    const status = latestPdfStatusByIllustration([
      job({ state: 'ACTION_REQUIRED', safeErrorCode: 'FORESIGHT_SSO_EXPIRED' }),
    ])
    expect(status.get('ill-1')).toEqual({
      state: 'BLOCKED',
      safeErrorCode: 'FORESIGHT_SSO_EXPIRED',
    })
    expect(illustrationPdfMessage(status.get('ill-1')!)).toBe(
      'K-Bot está aguardando você entrar na National Life para continuar o mesmo pedido.',
    )
  })

  // The portal-level reconnect park is the same user action as the carrier
  // SSO park: the next connection drains both. It must not disappear merely
  // because it uses the older safe code.
  it('also speaks when the portal asks for a reconnect', () => {
    const status = latestPdfStatusByIllustration([
      job({ state: 'ACTION_REQUIRED', safeErrorCode: 'NATIONAL_LIFE_RECONNECT_REQUIRED' }),
    ])
    expect(status.get('ill-1')).toEqual({
      state: 'BLOCKED',
      safeErrorCode: 'NATIONAL_LIFE_RECONNECT_REQUIRED',
    })
    expect(illustrationPdfMessage(status.get('ill-1')!)).toBe(
      'K-Bot está aguardando você entrar na National Life para continuar o mesmo pedido.',
    )
  })
})
