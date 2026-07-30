import type { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import type { GridRow, NationalLifeGridKey } from './portal-grid-client'

/// Normalised view of one carrier grid row. Every carrier field arrives as a
/// string (including premiums and dates), so nothing is coerced here beyond
/// trimming: the untouched row is kept in `raw` for later interpretation.
export type CaseSnapshot = {
  policyNo: string
  insuredName: string | null
  ownerName: string | null
  product: string | null
  carrierStatus: string | null
  deliveryStatus: string | null
  actionRequired: string | null
  requirements: string | null
  submitDate: string | null
  sentDate: string | null
  modalPremium: string | null
  anticipatedAnnualPremium: string | null
  submitMethod: string | null
  caseManager: string | null
  agency: string | null
  writingAgentName: string | null
  writingAgentNumber: string | null
  companyCode: string | null
  raw: GridRow
}

/// Grids disagree on column names for the same concept: new business calls the
/// status `DerivedStatusDescription` while recently-closed calls it `PolicyStatus`.
/// First key that yields a value wins.
function text(row: GridRow, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string') {
      const trimmed = stripMarkup(value)
      if (trimmed.length > 0) {
        return trimmed
      }
      continue
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }
  }
  return null
}

/// Several grid columns arrive as rendered HTML (links, badges, icons). Keep the
/// readable text for the normalised column; `raw` still holds the original.
function stripMarkup(value: string) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

export function toCaseSnapshot(row: GridRow): CaseSnapshot | null {
  const policyNo = text(row, 'PolicyNo')
  if (!policyNo) {
    // Without a policy number there is no stable key to upsert on.
    return null
  }

  return {
    policyNo,
    insuredName: text(row, 'InsuredOrAnnuitantName', 'InsuredName', 'ClientName'),
    ownerName: text(row, 'OwnerName'),
    product: text(row, 'Product', 'ProductName'),
    carrierStatus: text(row, 'DerivedStatusDescription', 'PolicyStatus', 'Status'),
    deliveryStatus: text(row, 'DeliveryStatus'),
    actionRequired: text(row, 'ActionRequired'),
    requirements: text(row, 'Requirements'),
    submitDate: text(row, 'SubmitDate'),
    sentDate: text(row, 'SentDate'),
    modalPremium: text(row, 'ModalPremium'),
    anticipatedAnnualPremium: text(
      row,
      'AnticipatedAnnualPremium',
      'AnticipatedAnnualPremiumDollarValue',
    ),
    submitMethod: text(row, 'SubmitMethod'),
    caseManager: text(row, 'CaseManager'),
    agency: text(row, 'Agency'),
    writingAgentName: text(row, 'WritingAgentName', 'AgentName'),
    writingAgentNumber: text(row, 'WritingAgentNumber', 'AgentNumber'),
    companyCode: text(row, 'CompanyCode'),
    raw: row,
  }
}

export function toCaseSnapshots(rows: GridRow[]): CaseSnapshot[] {
  const byPolicyNo = new Map<string, CaseSnapshot>()
  for (const row of rows) {
    const snapshot = toCaseSnapshot(row)
    if (snapshot) {
      // A grid can repeat a policy across pages when the carrier re-sorts between
      // requests; last write wins on a stable key.
      byPolicyNo.set(snapshot.policyNo, snapshot)
    }
  }
  return [...byPolicyNo.values()]
}

export type PersistSnapshotsInput = {
  agentId: string
  deploymentScope: string
  gridKey: NationalLifeGridKey
  snapshots: CaseSnapshot[]
  fetchedAt: Date
}

/// One round trip per chunk instead of per row; see persistInforcePolicies.
const UPSERT_CHUNK_SIZE = 500

export async function persistCaseSnapshots(
  input: PersistSnapshotsInput,
): Promise<{ written: number }> {
  let written = 0

  for (let offset = 0; offset < input.snapshots.length; offset += UPSERT_CHUNK_SIZE) {
    const chunk = input.snapshots.slice(offset, offset + UPSERT_CHUNK_SIZE)
    await prisma.$transaction(chunk.map((snapshot) => buildCaseSnapshotUpsert(input, snapshot)))
    written += chunk.length
  }

  return { written }
}

function buildCaseSnapshotUpsert(input: PersistSnapshotsInput, snapshot: CaseSnapshot) {
  const data = {
    insuredName: snapshot.insuredName,
    ownerName: snapshot.ownerName,
    product: snapshot.product,
    carrierStatus: snapshot.carrierStatus,
    deliveryStatus: snapshot.deliveryStatus,
    actionRequired: snapshot.actionRequired,
    requirements: snapshot.requirements,
    submitDate: snapshot.submitDate,
    sentDate: snapshot.sentDate,
    modalPremium: snapshot.modalPremium,
    anticipatedAnnualPremium: snapshot.anticipatedAnnualPremium,
    submitMethod: snapshot.submitMethod,
    caseManager: snapshot.caseManager,
    agency: snapshot.agency,
    writingAgentName: snapshot.writingAgentName,
    writingAgentNumber: snapshot.writingAgentNumber,
    companyCode: snapshot.companyCode,
    raw: snapshot.raw as Prisma.InputJsonValue,
    fetchedAt: input.fetchedAt,
  }

  return prisma.nationalLifeCaseSnapshot.upsert({
    where: {
      agentId_deploymentScope_gridKey_policyNo: {
        agentId: input.agentId,
        deploymentScope: input.deploymentScope,
        gridKey: input.gridKey,
        policyNo: snapshot.policyNo,
      },
    },
    create: {
      agentId: input.agentId,
      deploymentScope: input.deploymentScope,
      gridKey: input.gridKey,
      policyNo: snapshot.policyNo,
      ...data,
    },
    update: data,
  })
}
