'use strict'

/**
 * Read-only, aggregate audit of National Life data already stored by KeeprOne.
 *
 * Run inside the application container so it uses the exact Prisma client and
 * DATABASE_URL of the deployed release:
 *
 *   docker exec -i <app-container> node < scripts/audit-national-life-production.cjs
 *
 * The output deliberately excludes names, emails, phone numbers, policy
 * numbers, agent ids, carrier statement ids and raw payloads.
 */

// CommonJS is intentional: this file runs through plain `node` inside the
// production application container without a TypeScript loader.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient, Prisma } = require('@prisma/client')

const prisma = new PrismaClient({ log: [] })
const LOCAL_SCOPE = 'LOCAL_CONNECTOR'
const LEGACY_SCOPE = 'keepr-one-production-v1'
const LEGACY_COMMISSION_KEY = 'COMMISSION_DETAIL_NLD_COMMISSION_EARNING'
const COMMISSION_KEYS = new Set([
  'COMMISSIONS_EARNING_REPORT',
  LEGACY_COMMISSION_KEY,
])
const TERM_PRODUCTS = new Set(['LSW Term', 'NL Term'])

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function text(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function iso(value) {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null
}

function decimal(value) {
  if (value === null || value === undefined) return null
  try {
    return new Prisma.Decimal(value.toString())
  } catch {
    return null
  }
}

function sumDecimals(values) {
  return values.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0))
}

function fixed(value, places = 2) {
  return decimal(value)?.toFixed(places) ?? null
}

function carrierMoney(value) {
  const source = text(value)
  if (!source) return null
  const negative = /^\s*[(-]/.test(source)
  const digits = source.replace(/[^\d.]/g, '')
  if (digits === '' || digits === '.') return null
  try {
    const parsed = new Prisma.Decimal(digits)
    return negative ? parsed.negated() : parsed
  } catch {
    return null
  }
}

function carrierPeriod(value) {
  const source = text(value)
  if (!source) return null
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(source)
  return match ? `${match[3]}-${match[1].padStart(2, '0')}` : null
}

function commissionType(value) {
  const normalized = text(value)?.toLowerCase()
  if (normalized === 'personal') return 'DIRECT'
  if (normalized === 'override') return 'OVERRIDE'
  return null
}

function commissionIdentity(rawValue, amountsValue) {
  const raw = record(rawValue)
  const amounts = record(amountsValue)
  const policyNumber = raw.PolicyNumber
  const gross = raw.GrossCommEarned ?? amounts.GrossCommEarned
  if (policyNumber === undefined || policyNumber === null || gross === undefined || gross === null) {
    return null
  }
  const stable = { ...raw, GrossCommEarned: gross }
  delete stable.CommissionStatementId
  return JSON.stringify(
    Object.fromEntries(Object.entries(stable).sort(([left], [right]) => left.localeCompare(right))),
  )
}

function canonicalPolicyNumber(value) {
  return text(value)?.replace(/\s+/g, '').toUpperCase() ?? null
}

function normalizedMode(value) {
  return (text(value) ?? 'ANNUAL').replace(/[^A-Z]/gi, '').toUpperCase()
}

function annualizedPremium(value, mode) {
  const amount = decimal(value)
  if (!amount || !amount.isFinite() || amount.lte(0)) return null
  const normalized = normalizedMode(mode)
  if (normalized === 'MONTHLY' || normalized === 'MONTH') return amount.times(12)
  if (normalized === 'QUARTERLY' || normalized === 'QUARTER') return amount.times(4)
  if (normalized === 'SEMIANNUAL' || normalized === 'SEMIANNUALLY') return amount.times(2)
  if (normalized === 'ANNUAL' || normalized === 'ANNUALLY' || normalized === 'YEARLY') return amount
  return null
}

function mappedPolicyStatus(value) {
  const normalized = text(value)?.toLowerCase() ?? ''
  if (normalized === 'active') return 'INFORCE'
  if (normalized === 'issued') return 'APPROVED'
  if (normalized === 'pending lapse') return 'INFORCE'
  if (normalized === 'lapsed') return 'LAPSED'
  if (normalized === 'not active') return 'CANCELLED'
  return 'PENDING'
}

function stripMarkup(value) {
  return typeof value === 'string'
    ? value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ').trim()
    : value === null || value === undefined ? null : String(value)
}

function rawText(rawValue, keys) {
  const raw = record(rawValue)
  for (const key of keys) {
    const candidate = stripMarkup(raw[key])
    if (candidate) return candidate
  }
  return null
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] ?? 0) + amount
}

function moneyMapToObject(map) {
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, value.toFixed(2)]))
}

function countBy(rows, keyFor) {
  const result = {}
  for (const row of rows) increment(result, String(keyFor(row) ?? 'NULL'))
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)))
}

async function auditPolicies() {
  const policies = await prisma.policy.findMany({
    where: { sourceProvider: 'NATIONAL_LIFE' },
    select: {
      agentId: true,
      clientId: true,
      policyNumber: true,
      product: true,
      status: true,
      sourceStatus: true,
      sourceExternalId: true,
      faceAmount: true,
      faceAmountSource: true,
      premium: true,
      premiumMode: true,
      sourceUpdatedAt: true,
      carrierDetailUpdatedAt: true,
      createdAt: true,
    },
  })

  const inforce = policies.filter((row) => row.status === 'INFORCE')
  const faceAccepted = []
  const face = {
    accepted: 0,
    missingOrNonPositive: 0,
    positiveButUnverifiedSource: 0,
    verifiedSourceButMissingOrNonPositive: 0,
  }
  const premiumAccepted = []
  const storedPremiumByMode = new Map()
  const annualizedPremiumByMode = new Map()
  const premium = {
    accepted: 0,
    missingSourceTimestamp: 0,
    missingOrNonPositive: 0,
    unknownMode: 0,
    nullModeTreatedAsAnnual: 0,
    unknownModes: {},
    byStoredMode: {},
    storedAmountByMode: {},
    annualizedAmountByMode: {},
  }

  for (const policy of inforce) {
    const faceValue = decimal(policy.faceAmount)
    const validFace = Boolean(faceValue?.isFinite() && faceValue.gt(0))
    const verifiedFace = policy.faceAmountSource === 'NATIONAL_LIFE_POLICY_DETAIL'
    if (validFace && verifiedFace) {
      face.accepted += 1
      faceAccepted.push(faceValue)
    } else {
      if (!validFace) face.missingOrNonPositive += 1
      if (validFace && !verifiedFace) face.positiveButUnverifiedSource += 1
      if (!validFace && verifiedFace) face.verifiedSourceButMissingOrNonPositive += 1
    }

    if (!policy.sourceUpdatedAt) {
      premium.missingSourceTimestamp += 1
      continue
    }
    const base = decimal(policy.premium)
    if (!base?.isFinite() || base.lte(0)) {
      premium.missingOrNonPositive += 1
      continue
    }
    const annual = annualizedPremium(base, policy.premiumMode)
    if (!annual) {
      premium.unknownMode += 1
      increment(premium.unknownModes, text(policy.premiumMode) ?? 'NULL')
      continue
    }
    if (policy.premiumMode === null) premium.nullModeTreatedAsAnnual += 1
    const modeKey = text(policy.premiumMode) ?? 'NULL'
    increment(premium.byStoredMode, modeKey)
    storedPremiumByMode.set(modeKey,
      (storedPremiumByMode.get(modeKey) ?? new Prisma.Decimal(0)).plus(base))
    annualizedPremiumByMode.set(modeKey,
      (annualizedPremiumByMode.get(modeKey) ?? new Prisma.Decimal(0)).plus(annual))
    premium.accepted += 1
    premiumAccepted.push(annual)
  }

  const policyNumberCount = new Set(policies.map((row) => canonicalPolicyNumber(row.policyNumber))).size
  const sourceExternalCount = new Set(policies.map((row) => canonicalPolicyNumber(row.sourceExternalId))).size
  premium.storedAmountByMode = moneyMapToObject(storedPremiumByMode)
  premium.annualizedAmountByMode = moneyMapToObject(annualizedPremiumByMode)

  return {
    rowCount: policies.length,
    distinctAssignedAgentCount: new Set(policies.map((row) => row.agentId)).size,
    uniqueCanonicalPolicyNumbers: policyNumberCount,
    uniqueCanonicalSourceExternalIds: sourceExternalCount,
    duplicateCanonicalPolicyNumbers: policies.length - policyNumberCount,
    duplicateCanonicalSourceExternalIds: policies.length - sourceExternalCount,
    byStatus: countBy(policies, (row) => row.status),
    carrierStatusDistribution: countBy(policies, (row) => text(row.sourceStatus)),
    inforcePolicyCount: inforce.length,
    inforceDistinctClientCount: new Set(inforce.map((row) => row.clientId)).size,
    faceAmount: {
      ...face,
      coverageRate: inforce.length ? Number((face.accepted / inforce.length).toFixed(6)) : null,
      auditedTotal: sumDecimals(faceAccepted).toFixed(2),
      oldestCarrierDetailAt: iso(inforce.reduce((min, row) =>
        row.carrierDetailUpdatedAt && (!min || row.carrierDetailUpdatedAt < min)
          ? row.carrierDetailUpdatedAt : min, null)),
      newestCarrierDetailAt: iso(inforce.reduce((max, row) =>
        row.carrierDetailUpdatedAt && (!max || row.carrierDetailUpdatedAt > max)
          ? row.carrierDetailUpdatedAt : max, null)),
    },
    anticipatedAnnualPremium: {
      ...premium,
      coverageRate: inforce.length ? Number((premium.accepted / inforce.length).toFixed(6)) : null,
      auditedTotal: sumDecimals(premiumAccepted).toFixed(2),
      oldestSourceUpdatedAt: iso(inforce.reduce((min, row) =>
        row.sourceUpdatedAt && (!min || row.sourceUpdatedAt < min) ? row.sourceUpdatedAt : min, null)),
      newestSourceUpdatedAt: iso(inforce.reduce((max, row) =>
        row.sourceUpdatedAt && (!max || row.sourceUpdatedAt > max) ? row.sourceUpdatedAt : max, null)),
    },
  }
}

async function auditInforceLandingAndParity() {
  const [rows, agents, policies] = await Promise.all([
    prisma.nationalLifeInforcePolicy.findMany({
      select: {
        agentId: true,
        deploymentScope: true,
        agentNumber: true,
        policyNumber: true,
        policyStatus: true,
        productName: true,
        anticipatedAnnualPremium: true,
        targetPremium: true,
        termConversionDate: true,
        levelPeriodEndDate: true,
        raw: true,
        fetchedAt: true,
      },
    }),
    prisma.agent.findMany({ select: { id: true, npn: true, status: true } }),
    prisma.policy.findMany({
      where: { sourceProvider: 'NATIONAL_LIFE' },
      select: {
        agentId: true,
        policyNumber: true,
        sourceExternalId: true,
        status: true,
        product: true,
        premium: true,
        premiumMode: true,
      },
    }),
  ])
  const npnByAgent = new Map(agents.map((agent) => [agent.id, text(agent.npn)]))
  const activeAgentIds = new Set(agents.filter((agent) => agent.status === 'ACTIVE').map((agent) => agent.id))
  const policyByOwnerAndNumber = new Map(policies.map((policy) => [
    `${policy.agentId}\u0000${canonicalPolicyNumber(policy.policyNumber)}`,
    policy,
  ]))
  const policyByNumber = new Map(policies.map((policy) => [
    canonicalPolicyNumber(policy.policyNumber),
    policy,
  ]))
  const canonicalRows = rows.filter((row) => row.deploymentScope === LOCAL_SCOPE)
  const legacyRows = rows.filter((row) => row.deploymentScope === LEGACY_SCOPE)
  const digits = (value) => text(value)?.replace(/\D/g, '') ?? null
  const withoutLeadingZeros = (value) => digits(value)?.replace(/^0+/, '') ?? null
  const ownershipDiagnostics = {
    activeAgents: activeAgentIds.size,
    activeAgentsWithNpn: agents.filter((agent) =>
      agent.status === 'ACTIVE' && text(agent.npn),
    ).length,
    canonicalRowsWithAgentNumber: canonicalRows.filter((row) => text(row.agentNumber)).length,
    canonicalDistinctAgentNumbers: new Set(canonicalRows.map((row) => text(row.agentNumber)).filter(Boolean)).size,
    canonicalExactUploaderNpnMatch: canonicalRows.filter((row) =>
      text(row.agentNumber) === npnByAgent.get(row.agentId),
    ).length,
    canonicalDigitsOnlyUploaderNpnMatch: canonicalRows.filter((row) =>
      digits(row.agentNumber) && digits(row.agentNumber) === digits(npnByAgent.get(row.agentId)),
    ).length,
    canonicalNoLeadingZeroUploaderNpnMatch: canonicalRows.filter((row) =>
      withoutLeadingZeros(row.agentNumber) &&
      withoutLeadingZeros(row.agentNumber) === withoutLeadingZeros(npnByAgent.get(row.agentId)),
    ).length,
    legacyExactUploaderNpnMatch: legacyRows.filter((row) =>
      text(row.agentNumber) === npnByAgent.get(row.agentId),
    ).length,
  }
  const eligible = canonicalRows.filter((row) =>
    activeAgentIds.has(row.agentId) && text(row.agentNumber) !== null &&
    text(row.agentNumber) === npnByAgent.get(row.agentId),
  )

  const parity = {
    eligibleRows: eligible.length,
    missingPromotedPolicy: 0,
    statusMismatch: 0,
    productMismatch: 0,
    anticipatedAnnualPremiumMismatch: 0,
    promotedPolicyHasNonAnnualMode: 0,
    rawPolicyNumberMismatch: 0,
    rawAapMismatch: 0,
    rawTargetPremiumMismatch: 0,
  }
  const bookParityIgnoringUploaderNpn = {
    matchingPolicyNumber: 0,
    missingPromotedPolicy: 0,
    statusMismatch: 0,
    productMismatch: 0,
    anticipatedAnnualPremiumMismatch: 0,
  }
  const canonicalAap = []
  const canonicalInforceAap = []
  const canonicalStatus = {}

  for (const row of canonicalRows) {
    const sourceAap = carrierMoney(row.anticipatedAnnualPremium)
    if (sourceAap?.gt(0)) canonicalAap.push(sourceAap)
    const mappedStatus = mappedPolicyStatus(row.policyStatus)
    increment(canonicalStatus, mappedStatus)
    if (mappedStatus === 'INFORCE' && sourceAap?.gt(0)) canonicalInforceAap.push(sourceAap)
    const policy = policyByNumber.get(canonicalPolicyNumber(row.policyNumber))
    if (!policy) {
      bookParityIgnoringUploaderNpn.missingPromotedPolicy += 1
      continue
    }
    bookParityIgnoringUploaderNpn.matchingPolicyNumber += 1
    if (policy.status !== mappedPolicyStatus(row.policyStatus)) {
      bookParityIgnoringUploaderNpn.statusMismatch += 1
    }
    if (text(row.productName) && text(policy.product) !== text(row.productName)) {
      bookParityIgnoringUploaderNpn.productMismatch += 1
    }
    const policyPremium = decimal(policy.premium)
    if ((sourceAap === null) !== (policyPremium === null) ||
      (sourceAap && policyPremium && !sourceAap.equals(policyPremium))) {
      bookParityIgnoringUploaderNpn.anticipatedAnnualPremiumMismatch += 1
    }
  }

  for (const row of eligible) {
    const canonicalNumber = canonicalPolicyNumber(row.policyNumber)
    const policy = policyByOwnerAndNumber.get(`${row.agentId}\u0000${canonicalNumber}`)
    if (!policy) {
      parity.missingPromotedPolicy += 1
    } else {
      if (policy.status !== mappedPolicyStatus(row.policyStatus)) parity.statusMismatch += 1
      if (text(row.productName) && text(policy.product) !== text(row.productName)) parity.productMismatch += 1
      const sourceAap = carrierMoney(row.anticipatedAnnualPremium)
      const policyPremium = decimal(policy.premium)
      if ((sourceAap === null) !== (policyPremium === null) ||
        (sourceAap && policyPremium && !sourceAap.equals(policyPremium))) {
        parity.anticipatedAnnualPremiumMismatch += 1
      }
      if (policy.premiumMode !== null && !['ANNUAL', 'ANNUALLY', 'YEARLY'].includes(normalizedMode(policy.premiumMode))) {
        parity.promotedPolicyHasNonAnnualMode += 1
      }
    }

    const rawPolicy = rawText(row.raw, ['PolicyNumber', 'PolicyNo', 'Policy #'])
    const rawAap = rawText(row.raw, ['AAP', 'AnticipatedAnnualPremium', 'Anticipated Annual Premium'])
    const rawTarget = rawText(row.raw, [
      'TargetPremium', 'Target Premium', 'CommissionableTargetPremium',
      'Commissionable Target Premium', 'CTP', 'TargetPremiumAmount',
    ])
    if (canonicalPolicyNumber(rawPolicy) !== canonicalNumber) parity.rawPolicyNumberMismatch += 1
    if ((text(rawAap) ?? null) !== (text(row.anticipatedAnnualPremium) ?? null)) parity.rawAapMismatch += 1
    if ((text(rawTarget) ?? null) !== (text(row.targetPremium) ?? null)) parity.rawTargetPremiumMismatch += 1
  }

  const scopeStats = {}
  for (const row of rows) {
    if (!scopeStats[row.deploymentScope]) {
      scopeStats[row.deploymentScope] = { rows: 0, oldestFetchedAt: null, newestFetchedAt: null }
    }
    const stat = scopeStats[row.deploymentScope]
    stat.rows += 1
    const fetched = iso(row.fetchedAt)
    if (fetched && (!stat.oldestFetchedAt || fetched < stat.oldestFetchedAt)) stat.oldestFetchedAt = fetched
    if (fetched && (!stat.newestFetchedAt || fetched > stat.newestFetchedAt)) stat.newestFetchedAt = fetched
  }

  return {
    rowCount: rows.length,
    byDeploymentScope: Object.fromEntries(Object.entries(scopeStats).sort(([a], [b]) => a.localeCompare(b))),
    canonicalRows: canonicalRows.length,
    canonicalRowsOwnedByUploaderNpn: eligible.length,
    canonicalRowsNotOwnedByUploaderNpn: canonicalRows.length - eligible.length,
    ownershipDiagnostics,
    canonicalMissingAap: canonicalRows.filter((row) => !text(row.anticipatedAnnualPremium)).length,
    canonicalPositiveAapRows: canonicalAap.length,
    canonicalAapTotal: sumDecimals(canonicalAap).toFixed(2),
    canonicalByMappedStatus: Object.fromEntries(Object.entries(canonicalStatus).sort(([a], [b]) => a.localeCompare(b))),
    canonicalInforcePositiveAapRows: canonicalInforceAap.length,
    canonicalInforceAapTotal: sumDecimals(canonicalInforceAap).toFixed(2),
    canonicalMissingTargetPremium: canonicalRows.filter((row) => !text(row.targetPremium)).length,
    lapsedOrCancelledWithTermConversionDate: canonicalRows.filter((row) =>
      ['lapsed', 'not active'].includes(text(row.policyStatus)?.toLowerCase() ?? '') &&
      text(row.termConversionDate),
    ).length,
    lapsedOrCancelledWithLevelPeriodEndDate: canonicalRows.filter((row) =>
      ['lapsed', 'not active'].includes(text(row.policyStatus)?.toLowerCase() ?? '') &&
      text(row.levelPeriodEndDate),
    ).length,
    normalizedParity: parity,
    bookParityIgnoringUploaderNpn,
  }
}

async function auditCaseSnapshots() {
  const rows = await prisma.nationalLifeCaseSnapshot.findMany({
    select: {
      deploymentScope: true,
      gridKey: true,
      policyNo: true,
      writingAgentName: true,
      writingAgentNumber: true,
      agency: true,
      modalPremium: true,
      anticipatedAnnualPremium: true,
      targetPremium: true,
      fetchedAt: true,
    },
  })
  const byScopeAndGrid = {}
  for (const row of rows) {
    const key = `${row.deploymentScope}/${row.gridKey}`
    const stat = byScopeAndGrid[key] ?? {
      rows: 0,
      missingWritingAgentName: 0,
      missingWritingAgentNumber: 0,
      missingAgency: 0,
      missingModalPremium: 0,
      missingAap: 0,
      missingTargetPremium: 0,
      oldestFetchedAt: null,
      newestFetchedAt: null,
    }
    stat.rows += 1
    if (!text(row.writingAgentName)) stat.missingWritingAgentName += 1
    if (!text(row.writingAgentNumber)) stat.missingWritingAgentNumber += 1
    if (!text(row.agency)) stat.missingAgency += 1
    if (!text(row.modalPremium)) stat.missingModalPremium += 1
    if (!text(row.anticipatedAnnualPremium)) stat.missingAap += 1
    if (!text(row.targetPremium)) stat.missingTargetPremium += 1
    const fetched = iso(row.fetchedAt)
    if (fetched && (!stat.oldestFetchedAt || fetched < stat.oldestFetchedAt)) stat.oldestFetchedAt = fetched
    if (fetched && (!stat.newestFetchedAt || fetched > stat.newestFetchedAt)) stat.newestFetchedAt = fetched
    byScopeAndGrid[key] = stat
  }
  return {
    rowCount: rows.length,
    uniqueCanonicalPolicyNumbers: new Set(rows.map((row) => canonicalPolicyNumber(row.policyNo))).size,
    byScopeAndGrid: Object.fromEntries(Object.entries(byScopeAndGrid).sort(([a], [b]) => a.localeCompare(b))),
  }
}

async function auditPolicyDetails() {
  const details = await prisma.nationalLifePolicyDetailSnapshot.findMany({
    select: {
      agentId: true,
      deploymentScope: true,
      policyNumber: true,
      coverageCaptured: true,
      paymentsCaptured: true,
      totalFaceAmount: true,
      anticipatedAnnualPremium: true,
      ctp: true,
      observedAt: true,
      policy: {
        select: {
          agentId: true,
          policyNumber: true,
          faceAmount: true,
          faceAmountSource: true,
          carrierDetailUpdatedAt: true,
          premium: true,
        },
      },
    },
  })
  const result = {
    rowCount: details.length,
    coverageCaptured: 0,
    paymentsCaptured: 0,
    missingFaceWhenCoverageCaptured: 0,
    missingAapWhenPaymentsCaptured: 0,
    missingCtpWhenPaymentsCaptured: 0,
    ownerMismatch: 0,
    policyNumberMismatch: 0,
    faceAmountMismatch: 0,
    detailTimestampMismatch: 0,
    inforceAapVsDetailAapMismatch: 0,
    oldestObservedAt: null,
    newestObservedAt: null,
  }
  for (const detail of details) {
    if (detail.coverageCaptured) result.coverageCaptured += 1
    if (detail.paymentsCaptured) result.paymentsCaptured += 1
    if (detail.coverageCaptured && !decimal(detail.totalFaceAmount)?.gt(0)) {
      result.missingFaceWhenCoverageCaptured += 1
    }
    if (detail.paymentsCaptured && !decimal(detail.anticipatedAnnualPremium)?.gt(0)) {
      result.missingAapWhenPaymentsCaptured += 1
    }
    if (detail.paymentsCaptured && !decimal(detail.ctp)?.gt(0)) result.missingCtpWhenPaymentsCaptured += 1
    if (detail.agentId !== detail.policy.agentId) result.ownerMismatch += 1
    if (canonicalPolicyNumber(detail.policyNumber) !== canonicalPolicyNumber(detail.policy.policyNumber)) {
      result.policyNumberMismatch += 1
    }
    const detailFace = decimal(detail.totalFaceAmount)
    const policyFace = decimal(detail.policy.faceAmount)
    if (detail.coverageCaptured && detailFace && (!policyFace || !detailFace.equals(policyFace) ||
      detail.policy.faceAmountSource !== 'NATIONAL_LIFE_POLICY_DETAIL')) {
      result.faceAmountMismatch += 1
    }
    if (detail.policy.carrierDetailUpdatedAt?.getTime() !== detail.observedAt.getTime()) {
      result.detailTimestampMismatch += 1
    }
    const detailAap = decimal(detail.anticipatedAnnualPremium)
    const policyAap = decimal(detail.policy.premium)
    if (detailAap && policyAap && !detailAap.equals(policyAap)) {
      result.inforceAapVsDetailAapMismatch += 1
    }
    const observed = iso(detail.observedAt)
    if (observed && (!result.oldestObservedAt || observed < result.oldestObservedAt)) result.oldestObservedAt = observed
    if (observed && (!result.newestObservedAt || observed > result.newestObservedAt)) result.newestObservedAt = observed
  }
  return result
}

function preferCanonicalCommissionRows(rows) {
  const canonicalAgentPeriods = new Set(rows.filter((row) => row.deploymentScope === LOCAL_SCOPE)
    .map((row) => `${row.agentId}\u0000${carrierPeriod(record(row.raw).PaymentDate) ?? 'NO_PERIOD'}`))
  return rows.filter((row) => row.deploymentScope === LOCAL_SCOPE ||
    !canonicalAgentPeriods.has(`${row.agentId}\u0000${carrierPeriod(record(row.raw).PaymentDate) ?? 'NO_PERIOD'}`))
}

async function auditCommissions() {
  const rows = await prisma.nationalLifeReportRow.findMany({
    where: {
      OR: [
        { deploymentScope: LOCAL_SCOPE, gridKey: { in: [...COMMISSION_KEYS] } },
        { deploymentScope: LEGACY_SCOPE, gridKey: LEGACY_COMMISSION_KEY },
      ],
    },
    select: {
      id: true,
      agentId: true,
      deploymentScope: true,
      gridKey: true,
      rowKey: true,
      raw: true,
      amounts: true,
      fetchedAt: true,
    },
  })
  const preferred = preferCanonicalCommissionRows(rows)
  const rejectedByReason = {}
  const sourceAccounting = {}
  const seen = new Set()
  const accepted = []
  let duplicateCount = 0

  for (const row of preferred) {
    const sourceKey = `${row.deploymentScope}/${row.gridKey}`
    const sourceStat = sourceAccounting[sourceKey] ?? {
      received: 0, accepted: 0, duplicates: 0, rejected: 0, grossCommission: new Prisma.Decimal(0),
    }
    sourceStat.received += 1
    sourceAccounting[sourceKey] = sourceStat
    const raw = record(row.raw)
    const amounts = record(row.amounts)
    const amount = carrierMoney(amounts.GrossCommEarned ?? raw.GrossCommEarned)
    let reason = null
    if (!amount) reason = 'MISSING_GROSS_COMMISSION'
    else if (!commissionType(raw.WritingAgtLevel)) reason = 'UNKNOWN_WRITING_AGENT_LEVEL'
    else if (!text(raw.CommissionStatementId)) reason = 'MISSING_STATEMENT_ID'
    else if (!text(raw.PolicyNumber)) reason = 'MISSING_POLICY_NUMBER'
    else if (!carrierPeriod(raw.PaymentDate)) reason = 'MISSING_PAYMENT_DATE'
    const identity = commissionIdentity(raw, amounts)
    if (!reason && !identity) reason = 'MISSING_TRANSACTION_IDENTITY'
    if (!reason && !text(row.agentId)) reason = 'MISSING_SOURCE_OWNER'
    if (reason) {
      increment(rejectedByReason, reason)
      sourceStat.rejected += 1
      continue
    }
    const key = `${row.agentId}\u0000${identity}`
    if (seen.has(key)) {
      duplicateCount += 1
      sourceStat.duplicates += 1
      continue
    }
    seen.add(key)
    sourceStat.accepted += 1
    sourceStat.grossCommission = sourceStat.grossCommission.plus(amount)
    accepted.push({
      amount,
      type: commissionType(raw.WritingAgtLevel),
      period: carrierPeriod(raw.PaymentDate),
      policyNumber: canonicalPolicyNumber(raw.PolicyNumber),
    })
  }

  const totalByType = new Map()
  const totalByPeriod = new Map()
  for (const row of accepted) {
    totalByType.set(row.type, (totalByType.get(row.type) ?? new Prisma.Decimal(0)).plus(row.amount))
    totalByPeriod.set(row.period, (totalByPeriod.get(row.period) ?? new Prisma.Decimal(0)).plus(row.amount))
  }
  const policyNumbers = new Set(accepted.map((row) => row.policyNumber).filter(Boolean))
  const localPolicies = await prisma.policy.findMany({
    where: { sourceProvider: 'NATIONAL_LIFE' },
    select: { policyNumber: true },
  })
  const localPolicyNumbers = new Set(localPolicies.map((row) => canonicalPolicyNumber(row.policyNumber)))
  const matchedPolicyNumbers = [...policyNumbers].filter((number) => localPolicyNumbers.has(number)).length

  const [stored, transactions] = await Promise.all([
    prisma.commissionRecord.aggregate({ _count: { _all: true }, _sum: { amount: true } }),
    prisma.commissionTransaction.groupBy({ by: ['type'], _count: { _all: true }, _sum: { amount: true } }),
  ])

  const permissiveSeen = new Set()
  const permissive = []
  for (const row of preferred) {
    const raw = record(row.raw)
    const amounts = record(row.amounts)
    const amount = carrierMoney(amounts.GrossCommEarned ?? raw.GrossCommEarned)
    const type = commissionType(raw.WritingAgtLevel)
    if (!amount || !type) continue
    const identity = commissionIdentity(raw, amounts)
    const key = identity ? `${row.agentId}\u0000${identity}` : null
    if (key && permissiveSeen.has(key)) continue
    if (key) permissiveSeen.add(key)
    permissive.push({ amount, period: carrierPeriod(raw.PaymentDate) ?? 'NO_PERIOD', type })
  }
  const permissiveByPeriod = new Map()
  for (const row of permissive) {
    permissiveByPeriod.set(row.period,
      (permissiveByPeriod.get(row.period) ?? new Prisma.Decimal(0)).plus(row.amount))
  }

  return {
    receivedRowsAcrossSupportedScopes: rows.length,
    rowsAfterCanonicalScopePreference: preferred.length,
    legacyRowsExcludedBecauseCanonicalAgentMonthExists: rows.length - preferred.length,
    acceptedCount: accepted.length,
    duplicateCount,
    rejectedCount: Object.values(rejectedByReason).reduce((sum, count) => sum + count, 0),
    rejectedByReason: Object.fromEntries(Object.entries(rejectedByReason).sort(([a], [b]) => a.localeCompare(b))),
    auditGateWouldBlockDisplayedTotal: Object.keys(rejectedByReason).length > 0,
    acceptedGrossCommissionTotal: sumDecimals(accepted.map((row) => row.amount)).toFixed(2),
    acceptedGrossCommissionByType: moneyMapToObject(totalByType),
    acceptedGrossCommissionByPeriod: moneyMapToObject(totalByPeriod),
    sourceAccounting: Object.fromEntries(Object.entries(sourceAccounting)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, {
        received: value.received,
        accepted: value.accepted,
        duplicates: value.duplicates,
        rejected: value.rejected,
        grossCommission: value.grossCommission.toFixed(2),
      }])),
    currentProductionPermissiveRead: {
      recordCount: permissive.length,
      grossCommissionTotal: sumDecimals(permissive.map((row) => row.amount)).toFixed(2),
      grossCommissionByPeriod: moneyMapToObject(permissiveByPeriod),
      note: 'Mirrors the deployed permissive mapper; it does not require statement id, policy number or payment date.',
    },
    acceptedUniquePolicyNumbers: policyNumbers.size,
    acceptedPolicyNumbersPresentInCurrentBook: matchedPolicyNumbers,
    acceptedPolicyNumbersOutsideCurrentBook: policyNumbers.size - matchedPolicyNumbers,
    oldestFetchedAt: iso(preferred.reduce((min, row) => !min || row.fetchedAt < min ? row.fetchedAt : min, null)),
    newestFetchedAt: iso(preferred.reduce((max, row) => !max || row.fetchedAt > max ? row.fetchedAt : max, null)),
    separateInternalLedger: {
      commissionRecordCount: stored._count._all,
      commissionRecordAmount: fixed(stored._sum.amount),
      commissionTransactionsByType: Object.fromEntries(transactions.map((row) => [row.type, {
        count: row._count._all,
        amount: fixed(row._sum.amount),
      }])),
    },
  }
}

async function auditPromotionCredits() {
  const credits = await prisma.promotionCredit.findMany({
    where: { carrier: 'NATIONAL_LIFE' },
    select: {
      id: true,
      source: true,
      externalId: true,
      policyNumber: true,
      targetPremium: true,
      anticipatedAnnualPremium: true,
      qualificationWeight: true,
      creditedPc: true,
      status: true,
      recognizedAt: true,
      supersedesCreditId: true,
      attributions: { select: { kind: true, agentId: true, leaderAgentId: true } },
    },
  })
  const totalsByStatus = new Map()
  const findings = {
    missingPolicyNumber: 0,
    missingTargetPremium: 0,
    missingAnticipatedAnnualPremium: 0,
    missingQualificationWeight: 0,
    formulaMismatch: 0,
    invalidDeltaSign: 0,
    correctionWithoutSupersededCredit: 0,
    missingOrMultiplePersonalAttribution: 0,
    invalidAttributionShape: 0,
  }
  for (const credit of credits) {
    if (!text(credit.policyNumber)) findings.missingPolicyNumber += 1
    const target = decimal(credit.targetPremium)
    const aap = decimal(credit.anticipatedAnnualPremium)
    const weight = decimal(credit.qualificationWeight)
    const pc = decimal(credit.creditedPc)
    if (target === null) findings.missingTargetPremium += 1
    if (aap === null) findings.missingAnticipatedAnnualPremium += 1
    if (weight === null) findings.missingQualificationWeight += 1
    totalsByStatus.set(credit.status,
      (totalsByStatus.get(credit.status) ?? new Prisma.Decimal(0)).plus(pc ?? 0))
    if (['ESTIMATED', 'PENDING_CARRIER', 'CONFIRMED'].includes(credit.status) &&
      target && aap && weight && pc) {
      const expected = Prisma.Decimal.min(target, aap).times(weight)
      if (!expected.equals(pc)) findings.formulaMismatch += 1
    }
    const badSign = ['ESTIMATED', 'PENDING_CARRIER', 'CONFIRMED'].includes(credit.status)
      ? pc?.isNegative()
      : credit.status === 'ADJUSTED' ? pc?.isZero()
        : credit.status === 'REVERSED' ? !pc?.isNegative() : true
    if (badSign) findings.invalidDeltaSign += 1
    if (['ADJUSTED', 'REVERSED'].includes(credit.status) && !text(credit.supersedesCreditId)) {
      findings.correctionWithoutSupersededCredit += 1
    }
    const personal = credit.attributions.filter((row) => row.kind === 'PERSONAL')
    if (personal.length !== 1) findings.missingOrMultiplePersonalAttribution += 1
    if (credit.attributions.some((row) =>
      row.kind === 'PERSONAL'
        ? row.leaderAgentId !== null
        : row.kind === 'AGENCY'
          ? !row.leaderAgentId || row.leaderAgentId === row.agentId
          : true,
    )) findings.invalidAttributionShape += 1
  }

  const recognized = credits.filter((row) => ['CONFIRMED', 'ADJUSTED', 'REVERSED'].includes(row.status))
  return {
    rowCount: credits.length,
    bySource: countBy(credits, (row) => row.source),
    byStatus: countBy(credits, (row) => row.status),
    creditedPcByStatus: moneyMapToObject(totalsByStatus),
    recognizedCreditedPcTotal: sumDecimals(recognized.map((row) => decimal(row.creditedPc))).toFixed(2),
    uniqueCarrierEventIds: new Set(credits.map((row) => `${row.source}\u0000${row.externalId}`)).size,
    duplicateCarrierEventIds: credits.length - new Set(credits.map((row) => `${row.source}\u0000${row.externalId}`)).size,
    findings,
    oldestRecognizedAt: iso(credits.reduce((min, row) => !min || row.recognizedAt < min ? row.recognizedAt : min, null)),
    newestRecognizedAt: iso(credits.reduce((max, row) => !max || row.recognizedAt > max ? row.recognizedAt : max, null)),
  }
}

async function auditReportInventory() {
  const rows = await prisma.nationalLifeReportRow.groupBy({
    by: ['deploymentScope', 'gridKey'],
    _count: { _all: true },
    _min: { fetchedAt: true },
    _max: { fetchedAt: true },
    orderBy: [{ deploymentScope: 'asc' }, { gridKey: 'asc' }],
  })
  return rows.map((row) => ({
    deploymentScope: row.deploymentScope,
    gridKey: row.gridKey,
    rowCount: row._count._all,
    oldestFetchedAt: iso(row._min.fetchedAt),
    newestFetchedAt: iso(row._max.fetchedAt),
  }))
}

function safeFieldName(value) {
  return typeof value === 'string' && value.length <= 120 &&
    /^[A-Za-z0-9 _.,:#%()\/+&'?-]+$/.test(value)
    ? value
    : '<redacted-or-dynamic-field-name>'
}

async function auditLatestRawOnlySchemas() {
  const latest = await prisma.nationalLifeSyncRun.findFirst({
    where: { deploymentScope: LOCAL_SCOPE, provider: 'NATIONAL_LIFE', state: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, completedAt: true },
  })
  if (!latest) return { completedAt: null, grids: {} }
  const gridKeys = [
    'AGENT_DASHBOARD',
    'PREMIUM_REPORT_AGENCY',
    'PENDING_GROSS_COMMISSIONS',
    'COMMISSIONS_OVERVIEW',
    'COMMISSIONS_POLICY_HISTORY',
  ]
  const pages = await prisma.nationalLifeRawGridPage.findMany({
    where: { runId: latest.id, gridKey: { in: gridKeys } },
    select: { gridKey: true, recordCount: true, records: true },
  })
  const grids = {}
  for (const page of pages) {
    const stat = grids[page.gridKey] ?? {
      recordCount: 0,
      objectRecords: 0,
      nonObjectRecords: 0,
      fieldNames: new Set(),
      recordTypes: {},
      tableHeaders: new Set(),
      aggregateTableRows: [],
      tableRowShapes: [],
      tableSchemas: [],
      premiumReportCellRows: [],
    }
    stat.recordCount += page.recordCount
    for (const item of Array.isArray(page.records) ? page.records : []) {
      const candidate = record(item)
      if (!Object.keys(candidate).length) {
        stat.nonObjectRecords += 1
        continue
      }
      stat.objectRecords += 1
      for (const key of Object.keys(candidate)) stat.fieldNames.add(safeFieldName(key))
      increment(stat.recordTypes, text(candidate.RecordType) ?? 'NULL')
      if (Array.isArray(candidate.Headers)) {
        for (const header of candidate.Headers) stat.tableHeaders.add(safeFieldName(header))
        if (candidate.RecordType === 'TABLE_META') {
          stat.tableSchemas.push({
            tableIndex: Number.isInteger(candidate.TableIndex) ? candidate.TableIndex : null,
            headers: candidate.Headers.map(safeFieldName),
          })
        }
      }
      if (candidate.RecordType === 'TABLE_ROW') {
        stat.tableRowShapes.push({
          tableIndex: Number.isInteger(candidate.TableIndex) ? candidate.TableIndex : null,
          rowIndex: Number.isInteger(candidate.RowIndex) ? candidate.RowIndex : null,
          headers: Array.isArray(candidate.Headers) ? candidate.Headers.map(safeFieldName) : null,
          cellsLength: Array.isArray(candidate.Cells) ? candidate.Cells.length : null,
        })
        if (page.gridKey === 'PREMIUM_REPORT_AGENCY' && Array.isArray(candidate.Cells)) {
          stat.premiumReportCellRows.push(candidate.Cells.map((cell) =>
            stripMarkup(cell)?.slice(0, 80) ?? null))
        }
      }
      if (page.gridKey === 'PREMIUM_REPORT_AGENCY' && candidate.RecordType === 'TABLE_ROW' &&
        Array.isArray(candidate.Headers) && Array.isArray(candidate.Cells) &&
        candidate.Headers.length === candidate.Cells.length &&
        candidate.Headers.every((header) => [
          'Annualized', 'Annualized PIP', 'Annuities', 'Excess', 'Life',
          'Single', 'Target', 'Total', 'YTD',
        ].includes(String(header)))) {
        stat.aggregateTableRows.push(Object.fromEntries(candidate.Headers.map((header, index) => [
          String(header),
          stripMarkup(candidate.Cells[index])?.slice(0, 80) ?? null,
        ])))
      }
    }
    grids[page.gridKey] = stat
  }
  return {
    completedAt: iso(latest.completedAt),
    grids: Object.fromEntries(Object.entries(grids).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, stat]) => [key, {
        recordCount: stat.recordCount,
        objectRecords: stat.objectRecords,
        nonObjectRecords: stat.nonObjectRecords,
        fieldNames: [...stat.fieldNames].sort(),
        recordTypes: Object.fromEntries(Object.entries(stat.recordTypes).sort(([a], [b]) => a.localeCompare(b))),
        tableHeaders: [...stat.tableHeaders].sort(),
        tableRowShapes: stat.tableRowShapes,
        tableSchemas: stat.tableSchemas,
        ...(key === 'PREMIUM_REPORT_AGENCY'
          ? { premiumReportCellRows: stat.premiumReportCellRows }
          : {}),
        ...(key === 'PREMIUM_REPORT_AGENCY' ? { aggregateTableRows: stat.aggregateTableRows } : {}),
      }])),
  }
}

async function auditSyncRuns() {
  const runs = await prisma.nationalLifeSyncRun.findMany({
    where: { deploymentScope: LOCAL_SCOPE, provider: 'NATIONAL_LIFE' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      agentId: true,
      state: true,
      totalStages: true,
      completedStages: true,
      failedStages: true,
      plannedGridKeys: true,
      safeErrorCode: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  const latestByAgent = new Map()
  const latestCompletedByAgent = new Map()
  for (const run of runs) {
    if (!latestByAgent.has(run.agentId)) latestByAgent.set(run.agentId, run)
    if (run.state === 'COMPLETED' && !latestCompletedByAgent.has(run.agentId)) {
      latestCompletedByAgent.set(run.agentId, run)
    }
  }
  const auditedRuns = [...latestCompletedByAgent.values()]
  const runIds = auditedRuns.map((run) => run.id)
  const [receipts, completions, failures, pages] = runIds.length ? await Promise.all([
    prisma.nationalLifeConnectorStageReceipt.findMany({
      where: { runId: { in: runIds } },
      select: {
        runId: true,
        gridKey: true,
        sequence: true,
        recordCount: true,
        writtenCount: true,
        duplicateCount: true,
        rejectedCount: true,
        truncated: true,
      },
    }),
    prisma.nationalLifeConnectorStageCompletion.findMany({
      where: { runId: { in: runIds } },
      select: {
        runId: true,
        gridKey: true,
        expectedRecordCount: true,
        receivedRecordCount: true,
        finalSequence: true,
        truncated: true,
        completedAt: true,
      },
    }),
    prisma.nationalLifeConnectorStageFailure.findMany({
      where: { runId: { in: runIds } },
      select: { runId: true, gridKey: true, safeErrorCode: true, resolvedAt: true },
    }),
    prisma.nationalLifeRawGridPage.findMany({
      where: { runId: { in: runIds } },
      select: { runId: true, gridKey: true, sequence: true, recordCount: true },
    }),
  ]) : [[], [], [], []]

  const receiptsByStage = new Map()
  for (const receipt of receipts) {
    const key = `${receipt.runId}\u0000${receipt.gridKey}`
    const stat = receiptsByStage.get(key) ?? {
      recordCount: 0, writtenCount: 0, duplicateCount: 0, rejectedCount: 0,
      nullWrittenCount: 0, receiptCount: 0,
    }
    stat.recordCount += receipt.recordCount
    stat.writtenCount += receipt.writtenCount ?? 0
    stat.duplicateCount += receipt.duplicateCount
    stat.rejectedCount += receipt.rejectedCount
    stat.nullWrittenCount += receipt.writtenCount === null ? 1 : 0
    stat.receiptCount += 1
    receiptsByStage.set(key, stat)
  }
  const pagesByStage = new Map()
  for (const page of pages) {
    const key = `${page.runId}\u0000${page.gridKey}`
    pagesByStage.set(key, (pagesByStage.get(key) ?? 0) + page.recordCount)
  }
  const completionsByStage = new Map(completions.map((row) => [`${row.runId}\u0000${row.gridKey}`, row]))
  const failuresByStage = new Map(failures.map((row) => [`${row.runId}\u0000${row.gridKey}`, row]))

  const findings = {
    completedRunCounterMismatch: 0,
    missingPlannedStageCompletion: 0,
    expectedVsReceivedMismatch: 0,
    completionStillTruncated: 0,
    receiptAccountingMismatch: 0,
    rawPageVsReceivedMismatch: 0,
    nullWrittenCountReceipts: 0,
    normalizedRejectedRows: 0,
    unresolvedFailuresOnCompletedRuns: 0,
  }
  const latestCompletedStageAccounting = {}
  const rawOnlyStageKeys = new Set([
    'AGENT_DASHBOARD',
    'PREMIUM_REPORT_AGENCY',
    'POLICY_PAYMENT_HISTORY',
    'LIFE_PERSISTENCY',
    'PENDING_GROSS_COMMISSIONS',
    'COMMISSIONS_OVERVIEW',
    'COMMISSIONS_POLICY_HISTORY',
    'PLACEMENT_REPORT',
    'DAILY_UNIT_VALUES',
    'PIP_CONTRIBUTION_INCREASE',
    'ANNUITY_PAST_DUE_CONTRIBUTIONS',
    'ANNUITY_PAYROLL_FLOW_CHANGES',
    'INFORMAL_REQUESTS',
    'TRANSFER_COMPANY_INFORMATION',
  ])
  const sourceCoverage = {}
  for (const run of auditedRuns) {
    const planned = run.plannedGridKeys.length ? run.plannedGridKeys : ['NEW_BUSINESS', 'INFORCE_CLIENTS']
    if (run.totalStages !== planned.length || run.completedStages !== run.totalStages || run.failedStages !== 0) {
      findings.completedRunCounterMismatch += 1
    }
    for (const gridKey of planned) {
      if (!sourceCoverage[gridKey]) sourceCoverage[gridKey] = { plannedByAgents: 0, completedByAgents: 0 }
      sourceCoverage[gridKey].plannedByAgents += 1
      const key = `${run.id}\u0000${gridKey}`
      const completion = completionsByStage.get(key)
      const receipt = receiptsByStage.get(key)
      const rawCount = pagesByStage.get(key) ?? 0
      const failure = failuresByStage.get(key)
      if (!completion) {
        findings.missingPlannedStageCompletion += 1
      } else {
        sourceCoverage[gridKey].completedByAgents += 1
        if (completion.expectedRecordCount !== completion.receivedRecordCount) {
          findings.expectedVsReceivedMismatch += 1
        }
        if (completion.truncated) findings.completionStillTruncated += 1
        if (rawCount !== completion.receivedRecordCount) findings.rawPageVsReceivedMismatch += 1
      }
      if (receipt) {
        findings.nullWrittenCountReceipts += receipt.nullWrittenCount
        findings.normalizedRejectedRows += receipt.rejectedCount
        if (!rawOnlyStageKeys.has(gridKey) && receipt.nullWrittenCount === 0 && receipt.recordCount !==
          receipt.writtenCount + receipt.duplicateCount + receipt.rejectedCount) {
          findings.receiptAccountingMismatch += 1
        }
      } else if (completion?.receivedRecordCount !== 0) {
        findings.receiptAccountingMismatch += 1
      }
      if (failure && !failure.resolvedAt) findings.unresolvedFailuresOnCompletedRuns += 1
      const aggregate = latestCompletedStageAccounting[gridKey] ?? {
        storageMode: rawOnlyStageKeys.has(gridKey) ? 'RAW_PAGE_ONLY' : 'NORMALIZED_AND_RAW',
        runs: 0,
        expected: 0,
        received: 0,
        rawPageRecords: 0,
        receiptRecords: 0,
        written: 0,
        duplicates: 0,
        rejected: 0,
        missingCompletion: 0,
      }
      aggregate.runs += 1
      aggregate.expected += completion?.expectedRecordCount ?? 0
      aggregate.received += completion?.receivedRecordCount ?? 0
      aggregate.rawPageRecords += rawCount
      aggregate.receiptRecords += receipt?.recordCount ?? 0
      aggregate.written += receipt?.writtenCount ?? 0
      aggregate.duplicates += receipt?.duplicateCount ?? 0
      aggregate.rejected += receipt?.rejectedCount ?? 0
      aggregate.missingCompletion += completion ? 0 : 1
      latestCompletedStageAccounting[gridKey] = aggregate
    }
  }

  const unresolvedAll = await prisma.nationalLifeConnectorStageFailure.groupBy({
    by: ['gridKey', 'safeErrorCode'],
    where: { resolvedAt: null, run: { deploymentScope: LOCAL_SCOPE } },
    _count: { _all: true },
    orderBy: [{ gridKey: 'asc' }, { safeErrorCode: 'asc' }],
  })

  return {
    rowCount: runs.length,
    byState: countBy(runs, (run) => run.state),
    agentsWithAnyRun: new Set(runs.map((run) => run.agentId)).size,
    latestRunByAgentState: countBy([...latestByAgent.values()], (run) => run.state),
    agentsWithCompletedRun: auditedRuns.length,
    agentsWithoutCompletedRun: new Set(runs.map((run) => run.agentId)).size - auditedRuns.length,
    oldestLatestCompletedAt: iso(auditedRuns.reduce((min, run) =>
      run.completedAt && (!min || run.completedAt < min) ? run.completedAt : min, null)),
    newestLatestCompletedAt: iso(auditedRuns.reduce((max, run) =>
      run.completedAt && (!max || run.completedAt > max) ? run.completedAt : max, null)),
    latestCompletedRunsAudited: auditedRuns.length,
    sourceCoverageAcrossLatestCompletedRuns: Object.fromEntries(
      Object.entries(sourceCoverage).sort(([a], [b]) => a.localeCompare(b)),
    ),
    latestCompletedStageAccounting: Object.fromEntries(
      Object.entries(latestCompletedStageAccounting).sort(([a], [b]) => a.localeCompare(b)),
    ),
    findings,
    unresolvedFailuresAllRuns: unresolvedAll.map((row) => ({
      gridKey: row.gridKey,
      safeErrorCode: row.safeErrorCode,
      count: row._count._all,
    })),
  }
}

function illustrationResult(rawValue, isTerm) {
  const raw = record(rawValue)
  const result = record(isTerm ? raw.foresightTermResult : raw.foresightResult)
  return Object.keys(result).length ? result : null
}

async function auditIllustrations() {
  const illustrations = await prisma.illustration.findMany({
    where: { provider: 'NATIONAL_LIFE_FORESIGHT' },
    select: {
      id: true,
      kind: true,
      productName: true,
      faceAmount: true,
      premium: true,
      targetPremium: true,
      targetPremiumSource: true,
      documentMimeType: true,
      documentFetchedAt: true,
      rawPayload: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  const byProduct = {}
  const findings = {
    pdfWithoutCarrierResult: 0,
    carrierResultWithoutPdf: 0,
    faceAmountMismatch: 0,
    monthlyPremiumMismatch: 0,
    monthlyVsAnnualMismatch: 0,
    targetPremiumMismatch: 0,
    iulPdfWithoutQuickReview: 0,
    quickReviewWithoutSourceEvidence: 0,
    quickReviewWithoutAnnualProjection: 0,
    termPdfWithoutReconciledPremium: 0,
  }
  let readyPdfCount = 0
  let quickReviewCount = 0
  let largestObservedMonthlyVsAnnualDifference = new Prisma.Decimal(0)

  for (const illustration of illustrations) {
    const product = text(illustration.productName) ?? 'UNKNOWN'
    const stat = byProduct[product] ?? { rows: 0, readyPdf: 0, carrierResult: 0, quickReview: 0 }
    stat.rows += 1
    const isTerm = TERM_PRODUCTS.has(product)
    const pdfReady = Boolean(illustration.documentFetchedAt && illustration.documentMimeType === 'application/pdf')
    const result = illustrationResult(illustration.rawPayload, isTerm)
    const quickReview = !isTerm && result ? record(result.quickReview) : null
    if (pdfReady) {
      readyPdfCount += 1
      stat.readyPdf += 1
    }
    if (result) stat.carrierResult += 1
    if (quickReview && Object.keys(quickReview).length) {
      quickReviewCount += 1
      stat.quickReview += 1
    }
    byProduct[product] = stat
    if (pdfReady && !result) findings.pdfWithoutCarrierResult += 1
    if (result && !pdfReady) findings.carrierResultWithoutPdf += 1
    if (pdfReady && isTerm && !result) findings.termPdfWithoutReconciledPremium += 1
    if (pdfReady && !isTerm && (!quickReview || !Object.keys(quickReview).length)) {
      findings.iulPdfWithoutQuickReview += 1
    }
    if (!result) continue
    const confirmedFace = decimal(result.confirmedFaceAmount)
    const confirmedMonthly = decimal(result.confirmedMonthlyPremium)
    const confirmedAnnual = decimal(result.confirmedAnnualPremium)
    const storedFace = decimal(illustration.faceAmount)
    const storedPremium = decimal(illustration.premium)
    if (confirmedFace && (!storedFace || !confirmedFace.equals(storedFace))) findings.faceAmountMismatch += 1
    if (confirmedMonthly && (!storedPremium || !confirmedMonthly.equals(storedPremium))) {
      findings.monthlyPremiumMismatch += 1
    }
    if (confirmedMonthly && confirmedAnnual) {
      const annualDifference = confirmedMonthly.times(12).minus(confirmedAnnual).abs()
      largestObservedMonthlyVsAnnualDifference = Prisma.Decimal.max(
        largestObservedMonthlyVsAnnualDifference,
        annualDifference,
      )
      const annualTolerance = isTerm ? new Prisma.Decimal('0.01') : new Prisma.Decimal('0.06')
      if (annualDifference.gt(annualTolerance)) findings.monthlyVsAnnualMismatch += 1
    }
    if (quickReview && Object.keys(quickReview).length) {
      const summary = record(quickReview.summary)
      const quickTarget = decimal(summary.targetPremium)
      const storedTarget = decimal(illustration.targetPremium)
      if (!quickTarget || !storedTarget || !quickTarget.equals(storedTarget) ||
        illustration.targetPremiumSource !== 'FORESIGHT_QUICK_VIEW') {
        findings.targetPremiumMismatch += 1
      }
      const evidence = record(quickReview.evidence)
      if (evidence.source !== 'FORESIGHT_QUICK_VIEW' || !text(evidence.observedAt) ||
        !Array.isArray(evidence.sourceRows) || evidence.sourceRows.length < 2) {
        findings.quickReviewWithoutSourceEvidence += 1
      }
      if (!Array.isArray(quickReview.annualProjection) || quickReview.annualProjection.length < 1) {
        findings.quickReviewWithoutAnnualProjection += 1
      }
    }
  }

  const commands = await prisma.nationalLifeConnectorCommand.findMany({
    where: { capability: 'GENERATE_ILLUSTRATION' },
    select: { state: true, safeErrorCode: true, target: true, createdAt: true, completedAt: true },
  })
  return {
    rowCount: illustrations.length,
    readyPdfCount,
    quickReviewCount,
    largestObservedMonthlyVsAnnualDifference: largestObservedMonthlyVsAnnualDifference.toFixed(2),
    byProduct: Object.fromEntries(Object.entries(byProduct).sort(([a], [b]) => a.localeCompare(b))),
    findings,
    commands: {
      rowCount: commands.length,
      byState: countBy(commands, (row) => row.state),
      failureCodes: countBy(commands.filter((row) => row.state === 'FAILED'), (row) => text(row.safeErrorCode)),
      newestCreatedAt: iso(commands.reduce((max, row) => !max || row.createdAt > max ? row.createdAt : max, null)),
      newestCompletedAt: iso(commands.reduce((max, row) =>
        row.completedAt && (!max || row.completedAt > max) ? row.completedAt : max, null)),
    },
  }
}

async function auditDatabaseContract() {
  const applicationCreatorColumn = await prisma.$queryRawUnsafe(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'Application'
        AND column_name = 'createdByUserId'
    ) AS present
  `)
  const migrations = await prisma.$queryRawUnsafe(`
    SELECT migration_name, finished_at, rolled_back_at
    FROM "_prisma_migrations"
    ORDER BY started_at DESC
    LIMIT 5
  `)
  return {
    applicationCreatedByUserIdColumnPresent: Boolean(applicationCreatorColumn[0]?.present),
    latestMigrations: migrations.map((row) => ({
      migrationName: row.migration_name,
      finishedAt: iso(row.finished_at),
      rolledBackAt: iso(row.rolled_back_at),
    })),
  }
}

async function main() {
  const startedAt = new Date()
  const [
    policies,
    inforceLandingAndParity,
    caseSnapshots,
    policyDetails,
    commissions,
    promotionCredits,
    reportInventory,
    latestRawOnlySchemas,
    syncRuns,
    illustrations,
    databaseContract,
  ] = await Promise.all([
    auditPolicies(),
    auditInforceLandingAndParity(),
    auditCaseSnapshots(),
    auditPolicyDetails(),
    auditCommissions(),
    auditPromotionCredits(),
    auditReportInventory(),
    auditLatestRawOnlySchemas(),
    auditSyncRuns(),
    auditIllustrations(),
    auditDatabaseContract(),
  ])

  console.log(JSON.stringify({
    auditVersion: 1,
    mode: 'READ_ONLY_AGGREGATES_NO_PII',
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    scope: {
      provider: 'NATIONAL_LIFE',
      canonicalDeploymentScope: LOCAL_SCOPE,
      database: 'application DATABASE_URL',
    },
    policies,
    inforceLandingAndParity,
    caseSnapshots,
    policyDetails,
    commissions,
    promotionCredits,
    reportInventory,
    latestRawOnlySchemas,
    syncRuns,
    illustrations,
    databaseContract,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      mode: 'READ_ONLY_AGGREGATES_NO_PII',
      error: error instanceof Error ? error.message : 'UNKNOWN_AUDIT_ERROR',
    }))
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
