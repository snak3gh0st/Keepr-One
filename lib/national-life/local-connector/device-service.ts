import 'server-only'

import type { PrismaClient } from '@prisma/client'
import { NATIONAL_LIFE_PROVIDER } from '../constants'

type DeviceDb = Pick<
  PrismaClient,
  'nationalLifeConnectorDevice' | 'nationalLifeSyncRun' | '$transaction'
>

export class LocalConnectorDeviceError extends Error {
  constructor(readonly code: 'DEVICE_NOT_FOUND') {
    super(code)
  }
}

export async function listLocalConnectorDevices(
  db: Pick<PrismaClient, 'nationalLifeConnectorDevice'>,
  input: { agentId: string },
) {
  const devices = await db.nationalLifeConnectorDevice.findMany({
    where: { agentId: input.agentId, status: 'ACTIVE', revokedAt: null },
    orderBy: { lastSeenAt: 'desc' },
    select: {
      id: true,
      label: true,
      lastSeenAt: true,
      createdAt: true,
    },
  })
  return devices.map((device) => ({
    deviceId: device.id,
    label: device.label,
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    createdAt: device.createdAt.toISOString(),
  }))
}

export async function revokeLocalConnectorDevice(
  db: DeviceDb,
  input: { agentId: string; deviceId: string; now?: Date },
) {
  const now = input.now ?? new Date()
  return db.$transaction(async (tx) => {
    const updated = await tx.nationalLifeConnectorDevice.updateMany({
      where: {
        id: input.deviceId,
        agentId: input.agentId,
        status: 'ACTIVE',
        revokedAt: null,
      },
      data: {
        status: 'REVOKED',
        revokedAt: now,
        updatedAt: now,
      },
    })
    if (updated.count !== 1) throw new LocalConnectorDeviceError('DEVICE_NOT_FOUND')

    await tx.nationalLifeSyncRun.updateMany({
      where: {
        agentId: input.agentId,
        connectorDeviceId: input.deviceId,
        executionSource: 'LOCAL',
        provider: NATIONAL_LIFE_PROVIDER,
        // Um run pausado ou ainda na fila também morre com o dispositivo. Sem
        // eles, o painel de progresso seguiria anunciando "atualizando seus
        // dados" enquanto o cartão logo abaixo diz que o computador não está
        // mais conectado — duas telas contando histórias diferentes.
        state: { in: ['QUEUED', 'RUNNING', 'PAUSED'] },
      },
      data: {
        state: 'FAILED',
        safeErrorCode: 'LOCAL_CONNECTOR_REVOKED',
        completedAt: now,
        updatedAt: now,
      },
    })

    return { deviceId: input.deviceId, revokedAt: now.toISOString() }
  })
}
