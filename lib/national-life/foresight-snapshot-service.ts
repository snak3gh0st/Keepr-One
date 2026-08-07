import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  foresightDocumentKey,
  foresightDocumentsDir,
  writeForesightDocument,
} from './foresight-document-storage'
import { redactForesightPayload } from './foresight-sync'

export type ForesightCaseSnapshotInput = {
  agentId: string
  deploymentScope: string
  provider: string
  externalKey: string
  displayName: string
  caseKind: string | null
  product: string | null
  status: string | null
  state: string | null
  observedAt: Date
  raw: unknown
}

export type ForesightServiceSnapshotInput = {
  agentId: string
  deploymentScope: string
  provider: string
  caseSnapshotId: string
  serviceName: string
  payloadShape: unknown
  payload: unknown
  validationState: string
  observedAt: Date
}

export type ForesightDocumentInput = {
  agentId: string
  deploymentScope: string
  provider: string
  caseSnapshotId: string
  reportKey: string
  filename: string
  mimeType: string
  byteSize: number
  contentHash: string
  bytes: Uint8Array
  renderState: string
  safeErrorCode: string | null
  fetchedAt: Date | null
}

export async function upsertForesightCaseSnapshot(
  input: ForesightCaseSnapshotInput,
): Promise<{ id: string }> {
  const data = {
    displayName: input.displayName,
    caseKind: input.caseKind,
    product: input.product,
    status: input.status,
    state: input.state,
    observedAt: input.observedAt,
    raw: redactForesightPayload(input.raw) as Prisma.InputJsonValue,
  }
  return prisma.nationalLifeForesightCaseSnapshot.upsert({
    where: {
      agentId_deploymentScope_provider_externalKey: {
        agentId: input.agentId,
        deploymentScope: input.deploymentScope,
        provider: input.provider,
        externalKey: input.externalKey,
      },
    },
    create: { ...input, ...data },
    update: data,
    select: { id: true },
  })
}

export async function upsertForesightServiceSnapshot(
  input: ForesightServiceSnapshotInput,
): Promise<void> {
  const data = {
    agentId: input.agentId,
    deploymentScope: input.deploymentScope,
    provider: input.provider,
    payloadShape: input.payloadShape as Prisma.InputJsonValue,
    payload: redactForesightPayload(input.payload) as Prisma.InputJsonValue,
    validationState: input.validationState,
    observedAt: input.observedAt,
  }
  await prisma.nationalLifeForesightServiceSnapshot.upsert({
    where: {
      caseSnapshotId_serviceName: {
        caseSnapshotId: input.caseSnapshotId,
        serviceName: input.serviceName,
      },
    },
    create: { caseSnapshotId: input.caseSnapshotId, serviceName: input.serviceName, ...data },
    update: data,
  })
}

export async function upsertForesightDocument(input: ForesightDocumentInput): Promise<void> {
  const uploadsDir = foresightDocumentsDir()
  const storageKey = uploadsDir
    ? foresightDocumentKey(input.caseSnapshotId, input.reportKey)
    : null

  // Arquivo antes da linha, e não o contrário. Um arquivo sem linha é invisível
  // — ninguém o procura. Uma linha sem arquivo é um download que dá 404 para o
  // agente, com o banco afirmando que o documento existe.
  if (uploadsDir && storageKey) {
    await writeForesightDocument(uploadsDir, storageKey, new Uint8Array(input.bytes))
  }

  const data = {
    agentId: input.agentId,
    deploymentScope: input.deploymentScope,
    provider: input.provider,
    filename: input.filename,
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    contentHash: input.contentHash,
    storageKey,
    // Uma cópia, nunca duas. Com diretório configurado o PDF já está em disco e
    // o `null` explícito importa no caminho de update: sem ele, uma linha antiga
    // rerrenderizada ficaria com o PDF velho no banco *e* o novo em disco, e a
    // leitura serviria o velho. Sem diretório, o banco volta a ser o lugar.
    bytes: storageKey ? null : new Uint8Array(input.bytes),
    renderState: input.renderState,
    safeErrorCode: input.safeErrorCode,
    fetchedAt: input.fetchedAt,
  }
  await prisma.nationalLifeForesightDocument.upsert({
    where: {
      caseSnapshotId_reportKey: {
        caseSnapshotId: input.caseSnapshotId,
        reportKey: input.reportKey,
      },
    },
    create: { caseSnapshotId: input.caseSnapshotId, reportKey: input.reportKey, ...data },
    update: data,
  })
}
