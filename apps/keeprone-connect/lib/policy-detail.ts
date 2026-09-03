export type PolicyDetailSection = 'COVERAGE' | 'PAYMENTS'

export type PolicyDetailField = {
  section: PolicyDetailSection
  label: string
  value: string
}

export type PolicyDetailObservation = {
  navigatePath: string
  expectedPolicyNumber: string
  visiblePolicyNumber: string
  observedAt: string
  fields: PolicyDetailField[]
}

const LABELS: Record<PolicyDetailSection, readonly string[]> = {
  COVERAGE: [
    'Total Face Amount',
    'Base Face Amount',
    'Net Death Benefit',
    'MEC Limit',
    'Guideline Premium Limit',
  ],
  PAYMENTS: [
    'Next Scheduled Payment Date',
    'Payment Frequency',
    'Planned Periodic Payment',
    'Anticipated Annual Premium',
    'Minimum Monthly Premium',
    'Minimum Guaranteed Premium',
    'CTP',
  ],
}

const MAX_PAGE_TEXT = 256 * 1024
const MAX_VALUE_LENGTH = 256
const ALL_LABELS = new Set(Object.values(LABELS).flat())

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function lines(text: string): string[] {
  return text.slice(0, MAX_PAGE_TEXT).split(/\r?\n/).map(compact).filter(Boolean)
}

function valueAfterLabel(pageLines: readonly string[], label: string): string | null {
  for (let index = 0; index < pageLines.length; index += 1) {
    const line = pageLines[index]
    if (line === label) {
      const value = pageLines[index + 1]
      return value && value.length <= MAX_VALUE_LENGTH && !ALL_LABELS.has(value) ? value : null
    }
    if (line?.startsWith(`${label}:`)) {
      const value = compact(line.slice(label.length + 1))
      return value && value.length <= MAX_VALUE_LENGTH ? value : null
    }
  }
  return null
}

export function extractApprovedPolicyDetailFields(
  text: string,
  section: PolicyDetailSection,
): PolicyDetailField[] {
  const pageLines = lines(text)
  return LABELS[section].flatMap((label) => {
    const value = valueAfterLabel(pageLines, label)
    return value === null ? [] : [{ section, label, value }]
  })
}

function normalizedPolicyNumber(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase()
}

export function policyNumberIsVisible(text: string, expectedPolicyNumber: string): boolean {
  const expected = normalizedPolicyNumber(expectedPolicyNumber)
  if (!expected) return false
  return lines(text).some((line) => {
    const normalized = normalizedPolicyNumber(line)
    if (normalized === expected) return true
    if (normalized === `POLICYNUMBER:${expected}` || normalized === `POLICYNUMBER${expected}`) {
      return true
    }
    const index = normalized.indexOf(expected)
    if (index < 0) return false
    const before = normalized[index - 1]
    const after = normalized[index + expected.length]
    return (!before || !/[A-Z0-9]/.test(before)) && (!after || !/[A-Z0-9]/.test(after))
  })
}

function bodyText(document: Document): string {
  return document.body?.innerText ?? document.body?.textContent ?? ''
}

function findTab(document: Document, label: string): HTMLElement | null {
  const candidates = document.querySelectorAll('button, [role="tab"], a')
  for (const candidate of candidates) {
    if (compact(candidate.textContent ?? '') === label && candidate instanceof HTMLElement) {
      return candidate
    }
  }
  return null
}

async function waitForSection(
  document: Document,
  section: PolicyDetailSection,
  timeoutMs = 10_000,
): Promise<PolicyDetailField[]> {
  const deadline = Date.now() + timeoutMs
  do {
    const fields = extractApprovedPolicyDetailFields(bodyText(document), section)
    if (fields.length > 0) return fields
    await new Promise((resolve) => setTimeout(resolve, 100))
  } while (Date.now() < deadline)
  throw new Error('POLICY_DETAIL_SECTION_UNAVAILABLE')
}

async function captureSection(
  document: Document,
  section: PolicyDetailSection,
): Promise<PolicyDetailField[]> {
  const existing = extractApprovedPolicyDetailFields(bodyText(document), section)
  if (existing.length > 0) return existing
  const tab = findTab(document, section === 'COVERAGE' ? 'Coverage' : 'Payments')
  if (!tab) throw new Error('POLICY_DETAIL_SECTION_UNAVAILABLE')
  tab.click()
  return waitForSection(document, section)
}

export async function captureNationalLifePolicyDetail(
  document: Document,
  input: { navigatePath: string; expectedPolicyNumber: string },
): Promise<PolicyDetailObservation> {
  if (!policyNumberIsVisible(bodyText(document), input.expectedPolicyNumber)) {
    throw new Error('POLICY_DETAIL_TARGET_MISMATCH')
  }
  const coverage = await captureSection(document, 'COVERAGE')
  const payments = await captureSection(document, 'PAYMENTS')
  if (!policyNumberIsVisible(bodyText(document), input.expectedPolicyNumber)) {
    throw new Error('POLICY_DETAIL_TARGET_MISMATCH')
  }
  return {
    navigatePath: input.navigatePath,
    expectedPolicyNumber: input.expectedPolicyNumber,
    visiblePolicyNumber: input.expectedPolicyNumber,
    observedAt: new Date().toISOString(),
    fields: [...coverage, ...payments],
  }
}
