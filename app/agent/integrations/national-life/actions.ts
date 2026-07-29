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
        message:
          'Você atingiu o limite de conexões recentes. Aguarde alguns minutos e tente novamente.',
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
      message: 'Não foi possível iniciar a conexão National Life agora.',
    }
  }
}

export async function createNationalLifeViewerBootstrap(
  attemptId: string,
): Promise<ViewerBootstrapActionResult> {
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
      message:
        'A sessão segura não está mais disponível. Inicie uma nova conexão.',
    }
  }
}

export async function cancelNationalLifeConnection(
  attemptId: string,
): Promise<ConnectionMutationActionResult> {
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
      message: 'Não foi possível cancelar a conexão National Life agora.',
    }
  }
}

export async function disconnectNationalLifeConnection(): Promise<ConnectionMutationActionResult> {
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
      message: 'Não foi possível desconectar a National Life agora.',
    }
  }
}
