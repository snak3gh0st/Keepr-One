import type { PrismaClient } from '@prisma/client'
import { NATIONAL_LIFE_PROVIDER } from '../constants'
import { LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } from './config'
import { LocalConnectorRunError } from './run-service'

type AuthNotificationDb = Pick<
  PrismaClient,
  'nationalLifeSyncRun' | 'notification' | '$transaction'
>

export type LocalConnectorAuthState = 'REQUIRED' | 'RESTORED'

const NOTIFICATION_TYPE = 'NATIONAL_LIFE_LOGIN_REQUIRED'

function notificationKey(runId: string) {
  return `national-life-login-required:${runId}`
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
        agent: { select: { userId: true } },
      },
    })
    if (!run) throw new LocalConnectorRunError('RUN_NOT_ACTIVE')

    const dedupeKey = notificationKey(run.id)
    if (input.state === 'REQUIRED') {
      await tx.notification.upsert({
        where: { dedupeKey },
        create: {
          recipientUserId: run.agent.userId,
          type: NOTIFICATION_TYPE,
          title: 'Renove seu login da National Life',
          message: 'Seus dados continuam seguros. Entre novamente para o sync continuar de onde parou.',
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
          dedupeKey,
          readAt: null,
        },
        data: { readAt: now },
      })
    }

    return { runId: run.id, authState: input.state }
  })
}
