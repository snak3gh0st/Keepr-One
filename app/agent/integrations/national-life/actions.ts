'use server'

import { getCurrentAgent } from '@/lib/agent-context'
import {
  cancelConnectionAttempt,
  disconnectAgentSession,
  issueViewerBootstrap,
  startConnectionAttempt,
} from '@/lib/national-life/interactive-connection-service'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'
import { headers } from 'next/headers'
import { getServerI18n } from '@/lib/i18n/server'

export type StartConnectionActionResult =
  | { ok: true; attemptId: string; state: string; expiresAt: string }
  | { ok: false; message: string }

export type ViewerBootstrapActionResult =
  | { ok: true; bootstrapUrl: string; expiresAt: string }
  | { ok: false; message: string }

export type ConnectionMutationActionResult =
  | { ok: true }
  | { ok: false; message: string }

async function assertCurrentActionOrigin() {
  const requestHeaders = await headers()
  assertSameOriginAction({
    origin: requestHeaders.get('origin'),
    host: requestHeaders.get('host'),
    forwardedHost: requestHeaders.get('x-forwarded-host'),
    forwardedProto: requestHeaders.get('x-forwarded-proto'),
  })
}

export async function startNationalLifeConnection(): Promise<StartConnectionActionResult> {
  const { copy } = await getServerI18n()
  try {
    await assertCurrentActionOrigin()
    const agent = await getCurrentAgent()
    const result = await startConnectionAttempt({
      agentId: agent.id,
      userId: agent.userId,
    })
    if (result.kind === 'RATE_LIMITED') {
      return {
        ok: false,
        message: copy(
          'Você iniciou muitas conexões em pouco tempo. Aguarde alguns minutos e tente novamente.',
          'You have started too many connections in a short time. Wait a few minutes and try again.',
        ),
      }
    }
    return {
      ok: true,
      attemptId: result.attempt.id,
      state: result.attempt.state,
      expiresAt: result.attempt.expiresAt.toISOString(),
    }
  } catch {
    return {
      ok: false,
      message: copy('Não foi possível iniciar sua conexão com a National Life agora. Tente novamente.', 'We could not start your National Life connection right now. Please try again.'),
    }
  }
}

export async function createNationalLifeViewerBootstrap(
  attemptId: string,
): Promise<ViewerBootstrapActionResult> {
  const { copy } = await getServerI18n()
  try {
    await assertCurrentActionOrigin()
    const agent = await getCurrentAgent()
    const bootstrap = await issueViewerBootstrap({ agentId: agent.id, attemptId })
    return {
      ok: true,
      bootstrapUrl: bootstrap.bootstrapUrl,
      expiresAt: bootstrap.expiresAt.toISOString(),
    }
  } catch {
    return {
      ok: false,
      message: copy('Esta sessão segura não está mais disponível. Inicie uma nova conexão.', 'This secure session is no longer available. Start a new connection.'),
    }
  }
}

export async function cancelNationalLifeConnection(
  attemptId: string,
): Promise<ConnectionMutationActionResult> {
  const { copy } = await getServerI18n()
  try {
    await assertCurrentActionOrigin()
    const agent = await getCurrentAgent()
    await cancelConnectionAttempt({
      agentId: agent.id,
      userId: agent.userId,
      attemptId,
    })
    return { ok: true }
  } catch {
    return {
      ok: false,
      message: copy('Não foi possível cancelar sua conexão com a National Life agora. Tente novamente.', 'We could not cancel your National Life connection right now. Please try again.'),
    }
  }
}

export async function disconnectNationalLifeConnection(): Promise<ConnectionMutationActionResult> {
  const { copy } = await getServerI18n()
  try {
    await assertCurrentActionOrigin()
    const agent = await getCurrentAgent()
    await disconnectAgentSession({
      agentId: agent.id,
      userId: agent.userId,
    })
    return { ok: true }
  } catch {
    return {
      ok: false,
      message: copy('Não foi possível desconectar a National Life agora. Tente novamente.', 'We could not disconnect National Life right now. Please try again.'),
    }
  }
}
