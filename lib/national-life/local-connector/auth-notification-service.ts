import type { PrismaClient } from '@prisma/client'
import { NATIONAL_LIFE_PROVIDER } from '../constants'
import { LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } from './config'
import { LocalConnectorRunError } from './run-service'

type AuthNotificationDb = Pick<
  PrismaClient,
  'nationalLifeSyncRun' | 'notification' | '$transaction'
>

export type LocalConnectorAuthState = 'REQUIRED' | 'MFA_REQUIRED' | 'RESTORED'

const NOTIFICATION_TYPE = 'NATIONAL_LIFE_LOGIN_REQUIRED'
const MFA_NOTIFICATION_TYPE = 'NATIONAL_LIFE_MFA_REQUIRED'

function notificationKey(runId: string) {
  return `national-life-login-required:${runId}`
}

function mfaNotificationKey(runId: string, authEpoch: number) {
  return `national-life-mfa-required:${runId}:${authEpoch}`
}

/**
 * Mirrors only the recoverable authentication state to Keepr One. Carrier
 * credentials, MFA answers and browser session material never cross this API.
 */
export async function recordLocalConnectorAuthState(
  db: AuthNotificationDb,
  input: {
    agentId: string
    deviceId: string
    runId: string
    state: LocalConnectorAuthState
    now?: Date
  },
) {
  const now = input.now ?? new Date()

  return db.$transaction(async (tx) => {
    const run = await tx.nationalLifeSyncRun.findFirst({
      where: {
        id: input.runId,
        agentId: input.agentId,
        deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
        connectorDeviceId: input.deviceId,
        executionSource: 'LOCAL',
        provider: NATIONAL_LIFE_PROVIDER,
        state: 'RUNNING',
      },
      select: {
        id: true,
        authState: true,
        authEpoch: true,
        authRequiredAt: true,
        agent: { select: { userId: true } },
      },
    })
    if (!run) throw new LocalConnectorRunError('RUN_NOT_ACTIVE')

    const startsNewEpisode = input.state === 'REQUIRED' && run.authState === 'READY'
    const authEpoch = startsNewEpisode ? run.authEpoch + 1 : run.authEpoch
    const authRequiredAt = startsNewEpisode ? now : run.authRequiredAt
    const authState = input.state === 'RESTORED' ? 'READY' : input.state
    await tx.nationalLifeSyncRun.updateMany({
      where: {
        id: run.id,
        agentId: input.agentId,
        connectorDeviceId: input.deviceId,
        state: 'RUNNING',
      },
      data: {
        authState,
        authEpoch,
        authRequiredAt: input.state === 'RESTORED' ? null : authRequiredAt ?? now,
      },
    })

    const dedupeKey = input.state === 'MFA_REQUIRED'
      ? mfaNotificationKey(run.id, authEpoch)
      : notificationKey(run.id)
    if (input.state === 'REQUIRED' || input.state === 'MFA_REQUIRED') {
      const mfa = input.state === 'MFA_REQUIRED'
      await tx.notification.upsert({
        where: { dedupeKey },
        create: {
          recipientUserId: run.agent.userId,
          type: mfa ? MFA_NOTIFICATION_TYPE : NOTIFICATION_TYPE,
          title: mfa ? 'A National Life precisa da sua verificação' : 'Renove seu login da National Life',
          message: mfa
            ? 'Conclua o MFA diretamente na National Life. O K-Bot continuará depois da verificação.'
            : 'Seus dados continuam seguros. Entre novamente para o sync continuar de onde parou.',
          href: '/agent/integrations/national-life',
          dedupeKey,
          createdAt: now,
        },
        update: {
          readAt: null,
          createdAt: now,
        },
      })
    } else {
      await tx.notification.updateMany({
        where: {
          recipientUserId: run.agent.userId,
          readAt: null,
          OR: [
            { dedupeKey: notificationKey(run.id) },
            { dedupeKey: { startsWith: `national-life-mfa-required:${run.id}:` } },
          ],
        },
        data: { readAt: now },
      })
    }

    return { runId: run.id, authState: input.state, authEpoch }
  })
}
