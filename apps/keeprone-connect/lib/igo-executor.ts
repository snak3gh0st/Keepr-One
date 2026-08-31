import { sha256IgoApplicationDossier, type IgoApplicationSnapshotV2 } from './igo-contract'
import type {
  IgoApplicationDraftReceiptV2,
  IgoMissingQuestion,
} from './igo-messages'

const CASE_FRAME_ID = 'CossScreenFrame'
const LIST_PATH = '/webforms/caselistresp.aspx'
const NEW_CASE_PATH = '/webforms/newcaseresp.aspx'
const EXISTING_CASE_PATH = '/webforms/existingcaseresp.aspx'

export class IgoExecutionError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'IgoExecutionError'
  }
}

function fail(code: string): never {
  throw new IgoExecutionError(code)
}

function normalizedPath(): string {
  return location.pathname.toLowerCase()
}

async function waitFor<T>(
  read: () => T | null | undefined | false,
  code: string,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = read()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return fail(code)
}

function frameDocument(): Document | null {
  const frame = document.getElementById(CASE_FRAME_ID)
  if (!(frame instanceof HTMLIFrameElement)) return null
  try {
    return frame.contentDocument?.readyState === 'complete' ? frame.contentDocument : null
  } catch {
    return null
  }
}

function input(doc: Document, id: string): HTMLInputElement {
  const element = doc.getElementById(id)
  return element instanceof HTMLInputElement ? element : fail('IGO_SCHEMA_MISMATCH')
}

function select(doc: Document, id: string): HTMLSelectElement {
  const element = doc.getElementById(id)
  return element instanceof HTMLSelectElement ? element : fail('IGO_SCHEMA_MISMATCH')
}

function setNativeValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (!setter) fail('IGO_SCHEMA_MISMATCH')
  setter.call(element, value)
}

function emit(element: HTMLElement, type: string): void {
  element.dispatchEvent(new Event(type, { bubbles: true }))
}

function setTextInput(doc: Document, id: string, value: string): void {
  const element = input(doc, id)
  setNativeValue(element, value)
  emit(element, 'input')
  emit(element, 'change')
  emit(element, 'blur')
  if (element.value !== value) fail('IGO_WRITE_MISMATCH')
}

function setSelectValue(doc: Document, id: string, value: string): void {
  const element = select(doc, id)
  if (![...element.options].some((option) => option.value === value)) fail('IGO_OPTION_UNAVAILABLE')
  setNativeValue(element, value)
  emit(element, 'input')
  emit(element, 'change')
}

export function igoBirthDateSegments(value: string): { month: string; day: string; year: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return fail('IGO_BIRTH_DATE_INVALID')
  return { year: match[1]!, month: match[2]!, day: match[3]! }
}

function carrierBirthDate(value: string): string {
  const { month, day, year } = igoBirthDateSegments(value)
  return `${month}/${day}/${year}`
}

function setBirthDate(doc: Document, birthDate: string): void {
  const values = igoBirthDateSegments(birthDate)
  const fields = [
    ['.jq-dte-month', values.month],
    ['.jq-dte-day', values.day],
    ['.jq-dte-year', values.year],
  ] as const
  for (const [selector, value] of fields) {
    const element = doc.querySelector(selector)
    if (!(element instanceof HTMLInputElement)) fail('IGO_SCHEMA_MISMATCH')
    setNativeValue(element, value)
    emit(element, 'input')
    emit(element, 'change')
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }))
    element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', code: 'Tab', bubbles: true }))
    element.blur()
  }
}

export function igoDraftMarker(applicationId: string): string {
  if (!IDENTIFIER.test(applicationId)) return fail('IGO_APPLICATION_ID_INVALID')
  return `K-BOT DRAFT ${applicationId.slice(0, 20).toUpperCase()} - DO NOT SUBMIT`
}

export function igoProductTypeValue(snapshot: IgoApplicationSnapshotV2): '1,10' | '74,10' {
  return snapshot.dossier.coverage.family === 'TERM' ? '1,10' : '74,10'
}

export type IgoApplicationStage = {
  section: string
  screenId: string
  mode: 'DRAFT' | 'LOCK_BOUNDARY'
}

export function igoApplicationStages(family: 'TERM' | 'IUL'): IgoApplicationStage[] {
  return [
    { section: 'Pre-Qualification', screenId: 'screen_button_NLG_Screens_PreQual', mode: 'DRAFT' },
    { section: 'Agent Report', screenId: 'screen_button_NLG_Screens_AgentReportMRAS', mode: 'DRAFT' },
    { section: 'Agent Report, Cont', screenId: 'screen_button_NLG_Screens_AgentReportContMRAS', mode: 'DRAFT' },
    { section: 'Agent Information', screenId: 'screen_button_NLG_Screens_AgentInformationMRAS', mode: 'DRAFT' },
    { section: 'Primary Insured', screenId: 'screen_button_NLG_Screens_PrimaryInsuredCombined', mode: 'DRAFT' },
    { section: 'Beneficiaries - PI', screenId: 'screen_button_NLG_Screens_PIBeneficiaries', mode: 'DRAFT' },
    {
      section: 'Coverage Information',
      screenId: family === 'TERM'
        ? 'screen_button_NLG_Screens_CoverageInfoTL'
        : 'screen_button_NLG_Screens_CoverageInfo',
      mode: 'DRAFT',
    },
    { section: 'Premium', screenId: 'screen_button_NLG_Screens_PremiumMCA', mode: 'DRAFT' },
    { section: 'Existing Ins - PI', screenId: 'screen_button_NLG_Screens_PIOtherInsNonNAIC', mode: 'DRAFT' },
    { section: 'Notice and Consent - PI', screenId: 'screen_button_NLG_Screens_PIHIV1', mode: 'DRAFT' },
    {
      section: 'Part 1 Validate And Lock Data',
      screenId: 'screen_button_NLG_Screens_eSignHIPAA',
      mode: 'LOCK_BOUNDARY',
    },
  ]
}

export function igoMissingQuestions(snapshot: IgoApplicationSnapshotV2): IgoMissingQuestion[] {
  const questions: IgoMissingQuestion[] = [
    {
      section: 'Pre-Qualification',
      label: 'Do any of these conditions apply?',
      allowedValues: ['Yes', 'No'],
    },
    {
      section: 'Agent Report',
      label: 'Will this application be completed in person with each insured?',
      allowedValues: ['Yes', 'No'],
    },
    { section: 'Agent Report', label: 'How long have you known the Proposed Insured(s)?' },
    { section: 'Agent Report', label: 'Are you related?', allowedValues: ['Yes', 'No'] },
    {
      section: 'Agent Report',
      label: 'Is the Proposed Insured a National Life Group employee or spouse/child of an employee?',
      allowedValues: ['Yes', 'No'],
    },
    { section: 'Agent Report', label: 'What is the purpose of this insurance?' },
    { section: 'Agent Report', label: 'Which personal or business purpose subtype applies?' },
    { section: 'Agent Report', label: 'How was the face amount determined?' },
    { section: 'Agent Report', label: 'Additional information for underwriting or case context' },
    {
      section: 'Agent Report',
      label: 'If shown, did you provide investment advice or recommend liquidating securities?',
      allowedValues: ['Yes', 'No'],
    },
    {
      section: 'Agent Report',
      label: 'If shown, are you FINRA/SEC licensed?',
      allowedValues: ['Yes', 'No'],
    },
    {
      section: 'Agent Report, Cont',
      label: 'Does any Proposed Insured have existing life, disability, or annuity coverage?',
      allowedValues: ['Yes', 'No'],
    },
    {
      section: 'Agent Report, Cont',
      label: 'Will any existing coverage be replaced or changed?',
      allowedValues: ['Yes', 'No'],
    },
    { section: 'Agent Report, Cont', label: 'Which sales materials were used?' },
    { section: 'Agent Report, Cont', label: 'Is there a companion policy or application?', allowedValues: ['Yes', 'No'] },
    { section: 'Agent Report, Cont', label: 'Was any incentive or valuable consideration offered?', allowedValues: ['Yes', 'No'] },
    {
      section: 'Agent Report, Cont',
      label: 'Was third-party ownership or a life settlement discussed?',
      allowedValues: ['Yes', 'No'],
    },
    { section: 'Agent Information', label: 'Confirm the exact iGO Agent Number; do not infer or guess it' },
    { section: 'Agent Information', label: 'Agent state license number' },
    { section: 'Agent Information', label: 'Agent phone and email' },
    { section: 'Agent Information', label: 'Agent compensation percentage' },
    { section: 'Agent Information', label: 'Are additional agents included?', allowedValues: ['Yes', 'No'] },
    {
      section: 'Primary Insured',
      label: 'SSN, ITIN, or None selection and identification number when applicable',
    },
    { section: 'Primary Insured', label: 'Country of birth and citizenship' },
    { section: 'Primary Insured', label: 'Height and weight' },
    { section: 'Primary Insured', label: 'Military service status' },
    { section: 'Primary Insured', label: 'Employment, occupation, and employer details' },
    { section: 'Primary Insured', label: 'Driver license details' },
    { section: 'Primary Insured', label: 'Residential address' },
    { section: 'Primary Insured', label: 'Phone and email' },
    { section: 'Primary Insured', label: 'Is the mailing address different?', allowedValues: ['Yes', 'No'] },
    { section: 'Primary Insured', label: 'Owner and joint-owner selection and details' },
    {
      section: 'Primary Insured',
      label: 'Annual income, net worth, household income, household net worth, and household size',
    },
    {
      section: 'Beneficiaries - PI',
      label: 'At least one primary beneficiary with identity, relationship, contact details, and percent share',
    },
    { section: 'Beneficiaries - PI', label: 'Is there a contingent beneficiary?', allowedValues: ['Yes', 'No'] },
    { section: 'Coverage Information', label: 'Confirm the face amount matches the reviewed illustration' },
    { section: 'Coverage Information', label: 'Quoted underwriting rate class and any substandard details' },
    {
      section: 'Coverage Information',
      label: 'Underwriting requirements, preferred exam vendor, and translator requirement',
    },
    {
      section: 'Coverage Information',
      label: 'Illustration usage method and exact Illustration Unique ID',
    },
    {
      section: 'Premium',
      label: 'Billing type, payment frequency, and planned modal premium',
    },
    { section: 'Premium', label: 'Source of premium funds' },
    { section: 'Premium', label: 'Premium notice recipient' },
    {
      section: 'Existing Ins - PI',
      label: 'Does the Proposed Insured have in-force life insurance or annuity coverage?',
      allowedValues: ['Yes', 'No'],
    },
    {
      section: 'Existing Ins - PI',
      label: 'Will funds from in-force coverage be used for this application?',
      allowedValues: ['Yes', 'No'],
    },
    {
      section: 'Existing Ins - PI',
      label: 'Will any replacement activity occur?',
      allowedValues: ['Yes', 'No'],
    },
    {
      section: 'Notice and Consent - PI',
      label: 'Review the Notice and Consent; physician or provider contact is optional',
      allowedValues: ['Reviewed', 'Provide physician or provider details'],
    },
  ]
  if (snapshot.dossier.coverage.family === 'TERM') {
    questions.push({ section: 'Coverage Information', label: 'Confirm Term optional riders and benefits' })
  } else {
    questions.push({
      section: 'Coverage Information',
      label: 'Death Benefit Option and Definition of Life Insurance Test',
    })
    questions.push({
      section: 'Coverage Information',
      label: 'Confirm IUL optional benefits and riders, including the Death Benefit Protection Rider',
    })
  }
  if (snapshot.dossier.existingCoverage.hasExisting) {
    questions.push({ section: 'Existing Ins - PI', label: 'Existing policy carrier and coverage details' })
  }
  return questions
}

export type IgoCaseRowReadBack = {
  externalApplicationId: string
  status: string
  insuredName: string
  carrierProduct: string
  row: HTMLTableRowElement
}

export function findIgoCaseRow(doc: Document, snapshot: IgoApplicationSnapshotV2): IgoCaseRowReadBack | null {
  const marker = igoDraftMarker(snapshot.applicationId)
  const markerRows = [...doc.querySelectorAll<HTMLTableRowElement>('tr[data-case-id]')]
    .filter((row) => row.textContent?.includes(marker))
  if (markerRows.length > 1) return fail('IGO_CASE_AMBIGUOUS')
  const row = markerRows[0]
  if (!row) return null
  const externalApplicationId = row.dataset.caseId ?? ''
  const insuredName = row.querySelector<HTMLAnchorElement>('a.open-client')?.textContent?.trim() ?? ''
  const status = row.querySelector<HTMLElement>('.case-status')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  const expectedName = `${snapshot.dossier.insured.lastName}, ${snapshot.dossier.insured.firstName}`
  const productMatch = [...row.querySelectorAll<HTMLElement>('span')]
    .map((element) => element.textContent?.trim())
    .find((value) => value === snapshot.dossier.coverage.carrierProduct)
  if (!IDENTIFIER.test(externalApplicationId) || insuredName !== expectedName || !status || !productMatch) {
    return fail('IGO_CASE_READBACK_MISMATCH')
  }
  return { externalApplicationId, status, insuredName, carrierProduct: productMatch, row }
}

const IDENTIFIER = /^[A-Za-z0-9._:-]{1,200}$/

async function goToCaseList(): Promise<Document> {
  if (normalizedPath().endsWith(LIST_PATH)) return document
  const link = document.getElementById('PageBanner1_lnkMyCasesLink') ??
    document.getElementById('ctrlBanner_lnkMyCasesLink')
  if (!(link instanceof HTMLAnchorElement)) fail('IGO_SCHEMA_MISMATCH')
  link.click()
  return waitFor(() => normalizedPath().endsWith(LIST_PATH) ? document : null, 'IGO_NAVIGATION_TIMEOUT')
}

async function waitForCaseFrame(): Promise<Document> {
  return waitFor(() => frameDocument(), 'IGO_FRAME_TIMEOUT')
}

async function verifyCurrentCase(snapshot: IgoApplicationSnapshotV2): Promise<void> {
  const doc = await waitForCaseFrame()
  const expected = snapshot.dossier.insured
  if (input(doc, 'txtFirstName').value.trim() !== expected.firstName ||
    input(doc, 'txtLastName').value.trim() !== expected.lastName ||
    input(doc, 'txtBirthDate').value !== carrierBirthDate(expected.birthDate) ||
    select(doc, 'ddlGender').value !== (expected.sexAtBirth === 'MALE' ? 'Male' : 'Female') ||
    select(doc, 'ddlState').value !== snapshot.dossier.coverage.issueState ||
    input(doc, 'txtCaseDescription').value !== igoDraftMarker(snapshot.applicationId)) {
    fail('IGO_CASE_READBACK_MISMATCH')
  }
}

async function openExistingCase(readBack: IgoCaseRowReadBack, snapshot: IgoApplicationSnapshotV2): Promise<void> {
  const link = readBack.row.querySelector('a.open-client')
  if (!(link instanceof HTMLAnchorElement)) fail('IGO_SCHEMA_MISMATCH')
  link.click()
  await waitFor(() => normalizedPath().endsWith(EXISTING_CASE_PATH), 'IGO_NAVIGATION_TIMEOUT')
  await verifyCurrentCase(snapshot)
}

async function createCase(snapshot: IgoApplicationSnapshotV2): Promise<void> {
  const start = document.getElementById('btnNewCase')
  if (!(start instanceof HTMLAnchorElement)) fail('IGO_SCHEMA_MISMATCH')
  start.click()
  await waitFor(() => normalizedPath().endsWith(NEW_CASE_PATH), 'IGO_NAVIGATION_TIMEOUT')
  let doc = await waitForCaseFrame()

  setSelectValue(doc, 'ddlState', snapshot.dossier.coverage.issueState)
  doc = await waitFor(() => {
    const current = frameDocument()
    if (!current) return null
    const state = current.getElementById('ddlState')
    const productType = current.getElementById('ddlProductType')
    return state instanceof HTMLSelectElement && state.value === snapshot.dossier.coverage.issueState &&
      productType instanceof HTMLSelectElement && productType.options.length > 1 ? current : null
  }, 'IGO_STATE_SELECTION_TIMEOUT')

  setSelectValue(doc, 'ddlProductType', igoProductTypeValue(snapshot))
  doc = await waitFor(() => {
    const current = frameDocument()
    const button = current?.getElementById('btnFindAvailableProducts')
    const productType = current?.getElementById('ddlProductType')
    return current && button instanceof HTMLInputElement && !button.disabled &&
      productType instanceof HTMLSelectElement && productType.value === igoProductTypeValue(snapshot) ? current : null
  }, 'IGO_PRODUCT_TYPE_TIMEOUT')

  const findProducts = doc.getElementById('btnFindAvailableProducts')
  if (!(findProducts instanceof HTMLInputElement) || findProducts.disabled) fail('IGO_SCHEMA_MISMATCH')
  findProducts.click()
  doc = await waitFor(() => {
    const current = frameDocument()
    return current && [...current.querySelectorAll<HTMLTableRowElement>('tr')].some((row) =>
      [...row.querySelectorAll<HTMLElement>('td,span')].some((cell) =>
        cell.textContent?.trim() === snapshot.dossier.coverage.carrierProduct,
      ),
    ) ? current : null
  }, 'IGO_PRODUCT_SEARCH_TIMEOUT')

  setTextInput(doc, 'txtFirstName', snapshot.dossier.insured.firstName)
  setTextInput(doc, 'txtLastName', snapshot.dossier.insured.lastName)
  setTextInput(doc, 'txtCaseDescription', igoDraftMarker(snapshot.applicationId))
  setSelectValue(doc, 'ddlGender', snapshot.dossier.insured.sexAtBirth === 'MALE' ? 'Male' : 'Female')
  setBirthDate(doc, snapshot.dossier.insured.birthDate)
  await waitFor(() => input(doc, 'txtBirthDate').value === carrierBirthDate(snapshot.dossier.insured.birthDate) &&
    /^\d{1,3}$/.test(input(doc, 'txtAge').value) ? true : null, 'IGO_BIRTH_DATE_READBACK_TIMEOUT')

  const productRows = [...doc.querySelectorAll<HTMLTableRowElement>('tr')].filter((row) =>
    [...row.querySelectorAll<HTMLElement>('td,span')].some((cell) =>
      cell.textContent?.trim() === snapshot.dossier.coverage.carrierProduct,
    ),
  )
  if (productRows.length !== 1) fail(productRows.length ? 'IGO_PRODUCT_AMBIGUOUS' : 'IGO_PRODUCT_UNAVAILABLE')
  const selectProduct = [...productRows[0]!.querySelectorAll<HTMLInputElement>('input[type="submit"]')]
    .find((button) => button.value === 'Select')
  if (!selectProduct) fail('IGO_SCHEMA_MISMATCH')
  selectProduct.click()
  await waitFor(() => normalizedPath().endsWith(EXISTING_CASE_PATH), 'IGO_CASE_CREATE_TIMEOUT', 30_000)
  await verifyCurrentCase(snapshot)
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalize(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function executeIgoApplicationDraft(
  inputValue: { payloadHash: string; snapshot: IgoApplicationSnapshotV2 },
): Promise<IgoApplicationDraftReceiptV2> {
  if (location.origin !== 'https://igoforms2.ipipeline.com') fail('IGO_ORIGIN_MISMATCH')
  if (await sha256IgoApplicationDossier(inputValue.snapshot) !== inputValue.payloadHash ||
    inputValue.snapshot.payloadHash !== inputValue.payloadHash) fail('IGO_INPUT_HASH_MISMATCH')

  await goToCaseList()
  let row = findIgoCaseRow(document, inputValue.snapshot)
  if (row) {
    await openExistingCase(row, inputValue.snapshot)
  } else {
    await createCase(inputValue.snapshot)
    await goToCaseList()
    row = findIgoCaseRow(document, inputValue.snapshot)
    if (!row) fail('IGO_CASE_NOT_FOUND_AFTER_CREATE')
  }

  const coverage = inputValue.snapshot.dossier.coverage
  const confirmedValues = {
    insuredName: `${inputValue.snapshot.dossier.insured.firstName} ${inputValue.snapshot.dossier.insured.lastName}`,
    birthDate: inputValue.snapshot.dossier.insured.birthDate,
    family: coverage.family,
    carrierProduct: coverage.carrierProduct,
    termDuration: coverage.family === 'TERM' ? coverage.termDuration : null,
    issueState: coverage.issueState,
  } as const
  const missingQuestions = igoMissingQuestions(inputValue.snapshot)
  const readBack = {
    externalApplicationId: row.externalApplicationId,
    carrierStatus: row.status,
    progress: 'CASE_CREATED' as const,
    confirmedValues,
  }
  return {
    schemaVersion: 2,
    applicationId: inputValue.snapshot.applicationId,
    payloadHash: inputValue.payloadHash,
    draftReadBackHash: await sha256(readBack),
    ...readBack,
    changes: [],
    missingQuestions,
  }
}
