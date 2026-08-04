import type { GridKey } from './constants'

export type PortalRow = Record<string, unknown>

export type NewBusinessRecord = {
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
}

export type InforceClientRecord = {
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
  accumulatedCashValue: string | null
  anticipatedAnnualPremium: string | null
  termConversionDate: string | null
  levelPeriodEndDate: string | null
  employerName: string | null
}

export type NormalizedRecord = NewBusinessRecord | InforceClientRecord

const NEW_BUSINESS_KEYS = [
  'policyNo', 'insuredName', 'ownerName', 'product', 'carrierStatus', 'deliveryStatus',
  'actionRequired', 'requirements', 'submitDate', 'sentDate', 'modalPremium',
  'anticipatedAnnualPremium', 'submitMethod', 'caseManager', 'agency', 'writingAgentName',
  'writingAgentNumber', 'companyCode',
] as const

const INFORCE_KEYS = [
  'policyNumber', 'nbPolicyNumber', 'policyStatus', 'policyIssueDate', 'lastStatusChangeDate',
  'productClass', 'productName', 'productCode', 'companyCode', 'systemCode', 'planCode',
  'agentNumber', 'agentName', 'servicingAgentName', 'servicingAgencyName', 'insuredClientName',
  'insuredDob', 'insuredEmail', 'insuredPhoneNumber', 'ownerClientName', 'ownerDob', 'ownerEmail',
  'ownerPhoneNumber', 'accumulatedCashValue', 'anticipatedAnnualPremium', 'termConversionDate',
  'levelPeriodEndDate', 'employerName',
] as const

const ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
}

export function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, name: string) => {
      if (name.startsWith('#')) {
        const hex = name[1]?.toLowerCase() === 'x'
        const parsed = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10)
        return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : ' '
      }
      return ENTITIES[name.toLowerCase()] ?? ' '
    })
    .replace(/[<>\u0000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 512)
}

function text(row: PortalRow, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue
    const cleaned = stripMarkup(String(value))
    if (cleaned) return cleaned
  }
  return null
}

function email(row: PortalRow, ...keys: string[]): string | null {
  const value = text(row, ...keys)
  return value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320 ? value : null
}

export function normalizeNewBusiness(row: PortalRow): NewBusinessRecord | null {
  const policyNo = text(row, 'PolicyNo')
  if (!policyNo || policyNo.length > 128) return null
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
    anticipatedAnnualPremium: text(row, 'AnticipatedAnnualPremium', 'AnticipatedAnnualPremiumDollarValue'),
    submitMethod: text(row, 'SubmitMethod'),
    caseManager: text(row, 'CaseManager'),
    agency: text(row, 'Agency'),
    writingAgentName: text(row, 'WritingAgentName', 'AgentName'),
    writingAgentNumber: text(row, 'WritingAgentNumber', 'AgentNumber'),
    companyCode: text(row, 'CompanyCode'),
  }
}

export function normalizeInforceClient(row: PortalRow): InforceClientRecord | null {
  const policyNumber = text(row, 'PolicyNumber', 'PolicyNo')
  if (!policyNumber || policyNumber.length > 128) return null
  return {
    policyNumber,
    nbPolicyNumber: text(row, 'NBPolicyNumber'),
    policyStatus: text(row, 'PolicyStatus', 'PolStatus'),
    policyIssueDate: text(row, 'PolicyIssueDate'),
    lastStatusChangeDate: text(row, 'LastStatusChangeDate'),
    productClass: text(row, 'ProductClass'),
    productName: text(row, 'ProductName', 'Product'),
    productCode: text(row, 'ProductCode'),
    companyCode: text(row, 'CompanyCode'),
    systemCode: text(row, 'SystemCode'),
    planCode: text(row, 'PlanCode'),
    agentNumber: text(row, 'AgentNumber'),
    agentName: text(row, 'AgentName'),
    servicingAgentName: text(row, 'ServicingAgentName'),
    servicingAgencyName: text(row, 'ServicingAgencyName'),
    insuredClientName: text(row, 'InsuredClientName'),
    insuredDob: text(row, 'InsuredDOB'),
    insuredEmail: email(row, 'InsuredEmail'),
    insuredPhoneNumber: text(row, 'InsuredPhoneNumber'),
    ownerClientName: text(row, 'OwnerClientName'),
    ownerDob: text(row, 'OwnerDOB'),
    ownerEmail: email(row, 'OwnerEmail'),
    ownerPhoneNumber: text(row, 'OwnerPhoneNumber'),
    accumulatedCashValue: text(row, 'AccumulatedCashValue'),
    anticipatedAnnualPremium: text(row, 'AAP', 'AnticipatedAnnualPremium'),
    termConversionDate: text(row, 'TermConversionDate'),
    levelPeriodEndDate: text(row, 'LevelPeriodEndDate'),
    employerName: text(row, 'EmployerName'),
  }
}

export function normalizeRows(gridKey: GridKey, rows: unknown[]): NormalizedRecord[] {
  const normalized: NormalizedRecord[] = []
  const seen = new Set<string>()
  for (const value of rows) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const record =
      gridKey === 'NEW_BUSINESS'
        ? normalizeNewBusiness(value as PortalRow)
        : normalizeInforceClient(value as PortalRow)
    if (!record) continue
    const key = 'policyNo' in record ? record.policyNo : record.policyNumber
    if (!seen.has(key)) {
      seen.add(key)
      normalized.push(record)
    }
  }
  return normalized
}

export function isNormalizedRecord(gridKey: GridKey, value: unknown): value is NormalizedRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = gridKey === 'NEW_BUSINESS' ? NEW_BUSINESS_KEYS : INFORCE_KEYS
  if (Object.keys(record).length !== keys.length || !keys.every((key) => key in record)) return false
  const primary = gridKey === 'NEW_BUSINESS' ? record.policyNo : record.policyNumber
  if (typeof primary !== 'string' || primary.length < 1 || primary.length > 128) return false
  const validFields = keys.every((key) => {
    const field = record[key]
    return field === null || (typeof field === 'string' && field.length <= 512 && !/[<>\u0000]/.test(field))
  })
  if (!validFields || gridKey === 'NEW_BUSINESS') return validFields
  return ['insuredEmail', 'ownerEmail'].every((key) => {
    const field = record[key]
    return field === null || (
      typeof field === 'string' &&
      field.length <= 320 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field)
    )
  })
}
