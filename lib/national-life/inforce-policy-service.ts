import type { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import type { GridRow } from './portal-grid-client'

/// Normalised view of one inforce-book grid row. Every carrier field arrives as
/// a string, so nothing is coerced here beyond trimming: the untouched row is
/// kept in `raw` for later interpretation.
export type InforcePolicySnapshot = {
  policyNumber: string
  nbPolicyNumber: string | null
  policyStatus: string | null
  policyIssueDate: string | null
  lastStatusChangeDate: string | null
  productClass: string | null
  productName: string | null
  productCode: string | null
  companyCode: string | null
  systemCode: string | null
  planCode: string | null
  agentNumber: string | null
  agentName: string | null
  servicingAgentName: string | null
  servicingAgencyName: string | null
  insuredClientName: string | null
  insuredDob: string | null
  insuredEmail: string | null
  insuredPhoneNumber: string | null
  ownerClientName: string | null
  ownerDob: string | null
  ownerEmail: string | null
  ownerPhoneNumber: string | null
  insuredAddress: string | null
  insuredAddressLine1: string | null
  insuredAddressLine2: string | null
  insuredCity: string | null
  insuredState: string | null
  insuredZipcode: string | null
  ownerAddress: string | null
  ownerAddressLine1: string | null
  ownerAddressLine2: string | null
  ownerCity: string | null
  ownerState: string | null
  ownerZipcode: string | null
  accumulatedCashValue: string | null
  anticipatedAnnualPremium: string | null
  termConversionDate: string | null
  levelPeriodEndDate: string | null
  employerName: string | null
  raw: GridRow
}

function stripMarkup(value: string) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

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

export function toInforcePolicySnapshot(row: GridRow): InforcePolicySnapshot | null {
  const policyNumber = text(row, 'PolicyNumber', 'PolicyNo', 'Policy #')
  if (!policyNumber) {
    return null
  }

  return {
    policyNumber,
    nbPolicyNumber: text(row, 'NBPolicyNumber', 'NB Policy #'),
    policyStatus: text(row, 'PolicyStatus', 'PolStatus', 'Status'),
    policyIssueDate: text(row, 'PolicyIssueDate', 'Issue Date'),
    lastStatusChangeDate: text(row, 'LastStatusChangeDate', 'Inactive Status Date'),
    productClass: text(row, 'ProductClass', 'Type'),
    productName: text(row, 'ProductName', 'Product'),
    productCode: text(row, 'ProductCode'),
    companyCode: text(row, 'CompanyCode'),
    systemCode: text(row, 'SystemCode'),
    planCode: text(row, 'PlanCode'),
    agentNumber: text(row, 'AgentNumber', 'Agent #'),
    agentName: text(row, 'AgentName', 'Agent'),
    servicingAgentName: text(row, 'ServicingAgentName'),
    servicingAgencyName: text(row, 'ServicingAgencyName', 'Agency'),
    insuredClientName: text(row, 'InsuredClientName', 'Insured / Annuitant'),
    insuredDob: text(row, 'InsuredDOB'),
    insuredEmail: text(row, 'InsuredEmail', 'Insured/Annuitant Email'),
    insuredPhoneNumber: text(row, 'InsuredPhoneNumber', 'Insured/Annuitant Phone'),
    ownerClientName: text(row, 'OwnerClientName', 'Owner'),
    ownerDob: text(row, 'OwnerDOB'),
    ownerEmail: text(row, 'OwnerEmail', 'Owner Email'),
    ownerPhoneNumber: text(row, 'OwnerPhoneNumber', 'Owner Phone'),
    insuredAddress: text(row, 'InsuredAddress', 'Insured / Annuitant Address'),
    insuredAddressLine1: text(row, 'InsuredAddressLine1', 'Insured / Annuitant Address Line 1'),
    insuredAddressLine2: text(row, 'InsuredAddressLine2', 'Insured / Annuitant Address Line 2'),
    insuredCity: text(row, 'InsuredCity', 'Insured / Annuitant City'),
    insuredState: text(row, 'InsuredState', 'Insured / Annuitant State'),
    insuredZipcode: text(row, 'InsuredZipcode', 'Insured / Annuitant Zipcode'),
    ownerAddress: text(row, 'OwnerAddress', 'Owner Address'),
    ownerAddressLine1: text(row, 'OwnerAddressLine1', 'Owner Address Line 1'),
    ownerAddressLine2: text(row, 'OwnerAddressLine2', 'Owner Address Line 2'),
    ownerCity: text(row, 'OwnerCity', 'Owner City'),
    ownerState: text(row, 'OwnerState', 'Owner State'),
    ownerZipcode: text(row, 'OwnerZipcode', 'Owner Zipcode'),
    accumulatedCashValue: text(row, 'AccumulatedCashValue'),
    anticipatedAnnualPremium: text(row, 'AAP', 'AnticipatedAnnualPremium', 'Anticipated Annual Premium'),
    termConversionDate: text(row, 'TermConversionDate', 'Term Conversion Ending'),
    levelPeriodEndDate: text(row, 'LevelPeriodEndDate', 'End of Level Period'),
    employerName: text(row, 'EmployerName'),
    raw: row,
  }
}

export function toInforcePolicySnapshots(rows: GridRow[]): InforcePolicySnapshot[] {
  const byPolicyNumber = new Map<string, InforcePolicySnapshot>()
  for (const row of rows) {
    const snapshot = toInforcePolicySnapshot(row)
    if (snapshot) {
      byPolicyNumber.set(snapshot.policyNumber, snapshot)
    }
  }
  return [...byPolicyNumber.values()]
}

export type PersistInforcePoliciesInput = {
  agentId: string
  deploymentScope: string
  snapshots: InforcePolicySnapshot[]
  fetchedAt: Date
}

/// One round trip per chunk instead of per row. Ten thousand policies as
/// individual awaited upserts took minutes, which is too slow to sit inside a
/// scheduled job.
const UPSERT_CHUNK_SIZE = 500

export async function persistInforcePolicies(
  input: PersistInforcePoliciesInput,
): Promise<{ written: number }> {
  let written = 0

  for (let offset = 0; offset < input.snapshots.length; offset += UPSERT_CHUNK_SIZE) {
    const chunk = input.snapshots.slice(offset, offset + UPSERT_CHUNK_SIZE)

    await prisma.$transaction(
      chunk.map((snapshot) => {
        const { raw, policyNumber, ...rest } = snapshot
        const data = { ...rest, raw: raw as Prisma.InputJsonValue, fetchedAt: input.fetchedAt }

        return prisma.nationalLifeInforcePolicy.upsert({
          where: {
            agentId_deploymentScope_policyNumber: {
              agentId: input.agentId,
              deploymentScope: input.deploymentScope,
              policyNumber,
            },
          },
          create: {
            agentId: input.agentId,
            deploymentScope: input.deploymentScope,
            policyNumber,
            ...data,
          },
          update: data,
        })
      }),
    )
    written += chunk.length
  }

  return { written }
}
