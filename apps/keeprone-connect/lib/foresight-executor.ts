import {
  classifyForesightLocation,
  parseForesightRelease,
  sha256ForesightSnapshot,
  type ForesightIllustrationSnapshot,
  type ForesightIllustrationSnapshotV1,
  type ForesightSolvedIllustrationSnapshotV2,
} from './foresight-contract'
import {
  FORESIGHT_FLEXLIFE_FIELDS,
  buildForesightTarget,
  carrierAmountEquals,
  compareForesightTarget,
  deterministicCaseFingerprint,
  foresightReadbackMismatchCode,
  foresightSolveLabel,
  validateForesightSurface,
  type ForesightMaterialReadback,
  foresightClientBirthDate,
} from './foresight-target'
import type {
  AnyForesightExecutionReceipt,
  ForesightExecutionDocument,
  ForesightExecutionReceipt,
  ForesightQuickReview,
  ForesightQuickReviewUnavailable,
  ForesightSolvedExecutionReceipt,
} from './foresight-messages'
import type { ForesightProgressPhase } from './foresight-progress'

type ProgressReporter = (phase: ForesightProgressPhase) => void

const MAIN_FRAME_ID = 'ctl00_mobilityPH_iframeMain'
const MODAL_FRAME_ID = 'ctl00_mobilityPH_modalDialog__Iframe'
const MAIN_CHANNEL = 'FYNTRA_FORESIGHT_CONNECTOR_V1'
const NEW_ILLUSTRATION_ID = 'ctl00_mobilityPH_verticalMenu_ActivitiesNewIllustration_0'
const FLEX_LIFE_ID = 'ctl00_mobilityPH_WebpanelProduct_grdProducts_ctl02_lnkProduct'
const SAVE_AS_ID = 'ctl00_mobilityPH_ucInfoContainer_lnkSaveAs'
const SAVE_NAME_ID = 'ctl00_mobilityPH_panelContent_txtItemName'
const SAVE_FOLDER_ID = 'ctl00_mobilityPH_panelContent_cboFolder'
const SAVE_CONFIRM_ID = 'ctl00_mobilityPH_panelContent_cmdSave'

const PRODUCT_SELECTION = {
  jurisdiction: 'ctl00_mobilityPH_WebpanelGeneral_cboJurisdiction',
  productType: 'ctl00_mobilityPH_WebpanelGeneral_cboProductType',
  salesConcept: 'ctl00_mobilityPH_WebpanelGeneral_cboSalesConcept',
} as const

const RIDER_FIELDS = {
  BalanceSheetBenefit: 'ctl00_mobilityPH_panelRiders_ucRiderInput_cboBalanceSheetBenefit',
  BenefitDistributionOption: 'ctl00_mobilityPH_panelRiders_ucRiderInput_cboBenefitDistributionOption',
  ChildTerm: 'ctl00_mobilityPH_panelRiders_ucRiderInput_cboChildTerm',
  DeathBenefitProtection: 'ctl00_mobilityPH_panelRiders_ucRiderInput_cboDBPR',
  GuaranteedInsurability: 'ctl00_mobilityPH_panelRiders_ucRiderInput_cboGIR',
  WaiverOfPremium: 'ctl00_mobilityPH_panelRiders_ucRiderInput_cboWPR',
  PremiumChronicCare: 'ctl00_mobilityPH_panelABPSummary_ucAcceleratedBenefitsSummary_cboPremiumChronicCare',
  ABRTerminalIllness: 'ctl00_mobilityPH_panelABPSummary_ucAcceleratedBenefitsSummary_cboABRTerminal',
  ABRChronicIllness: 'ctl00_mobilityPH_panelABPSummary_ucAcceleratedBenefitsSummary_cboABRChronic',
  ABRCriticalIllness: 'ctl00_mobilityPH_panelABPSummary_ucAcceleratedBenefitsSummary_cboABRCritical',
  ABRCriticalInjury: 'ctl00_mobilityPH_panelABPSummary_ucAcceleratedBenefitsSummary_cboABRCriticalInjury',
  ABRAlzheimersDisease: 'ctl00_mobilityPH_panelABPSummary_ucAcceleratedBenefitsSummary_cboABRAlz',
} as const

const ALLOCATION_FIELDS = {
  fixed: 'ctl00_mobilityPH_panelInterestRates_txtFixedStrategyAllocation',
  capFocus: 'ctl00_mobilityPH_panelInterestRates_txtStrategy1Allocation',
  participationFocus: 'ctl00_mobilityPH_panelInterestRates_txtStrategy2Allocation',
  floor: 'ctl00_mobilityPH_panelInterestRates_txtStrategy3Allocation',
  balancedTrend: 'ctl00_mobilityPH_panelInterestRates_txtStrategy4Allocation',
  pacesetter: 'ctl00_mobilityPH_panelInterestRates_txtStrategy5Allocation',
  strategy6: 'ctl00_mobilityPH_panelInterestRates_txtStrategy6Allocation',
  total: 'ctl00_mobilityPH_panelInterestRates_txtTotalAllocation',
} as const

const MENU_IDS = {
  client: 'ctl00_mobilityPH_verticalMenu_Client_0',
  ledger: 'ctl00_mobilityPH_verticalMenu_Ledger_0',
  riders: 'ctl00_mobilityPH_verticalMenu_Product_0',
  interestRates: 'ctl00_mobilityPH_verticalMenu_InterestRate_0',
  quickView: 'ctl00_mobilityPH_verticalMenu_Quickview_1',
  reports: 'ctl00_mobilityPH_verticalMenu_Reportselection_2',
} as const

const NAIC_REPORT_GROUP_ID =
  'ctl00_mobilityPH_panelReports_ctl00_rptAvailableReports_ctl00_chkGroup'

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida',
  GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}

export class ForesightExecutionError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

function fail(code: string): never {
  throw new ForesightExecutionError(code)
}

async function waitFor<T>(read: () => T | null | undefined | false, code: string, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = read()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return fail(code)
}

function frame(id: string): HTMLIFrameElement {
  const value = document.getElementById(id)
  return value instanceof HTMLIFrameElement ? value : fail('FORESIGHT_SCHEMA_MISMATCH')
}

function frameDocument(id: string): Document | null {
  try {
    const value = frame(id)
    return value.contentDocument?.readyState === 'complete' ? value.contentDocument : null
  } catch {
    return null
  }
}

function framePath(id: string): string | null {
  try {
    return frame(id).contentWindow?.location.pathname ?? null
  } catch {
    return null
  }
}

async function waitForFrame(path: string, id = MAIN_FRAME_ID): Promise<Document> {
  return waitFor(() => framePath(id) === path ? frameDocument(id) : null, 'FORESIGHT_NAVIGATION_TIMEOUT')
}

function input(doc: Document, id: string): HTMLInputElement {
  const value = doc.getElementById(id)
  return value?.tagName === 'INPUT' ? value as HTMLInputElement : fail('FORESIGHT_SCHEMA_MISMATCH')
}

function select(doc: Document, id: string): HTMLSelectElement {
  const value = doc.getElementById(id)
  return value?.tagName === 'SELECT' ? value as HTMLSelectElement : fail('FORESIGHT_SCHEMA_MISMATCH')
}

function click(doc: Document, id: string): void {
  const value = doc.getElementById(id) as HTMLElement | null
  if (!value || typeof value.click !== 'function') fail('FORESIGHT_SCHEMA_MISMATCH')
  value.click()
}

function emitChange(element: HTMLInputElement | HTMLSelectElement): void {
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
  element.dispatchEvent(new Event('blur', { bubbles: true }))
}

function setInput(doc: Document, id: string, value: string): void {
  const element = input(doc, id)
  element.value = value
  emitChange(element)
  if (element.value !== value) fail('FORESIGHT_WRITE_MISMATCH')
}

function selectedText(element: HTMLSelectElement): string {
  return element.selectedOptions[0]?.text.trim() ?? ''
}

function optionValue(doc: Document, id: string, text: string): string {
  const option = [...select(doc, id).options].find((candidate) => candidate.text.trim() === text)
  return option?.value ?? fail('FORESIGHT_SCHEMA_MISMATCH')
}

async function applyInMainWorld(
  type: 'APPLY_CLIENT' | 'APPLY_LEDGER' | 'APPLY_LEDGER_SOLVE' | 'APPLY_ALLOCATION',
  values: Record<string, string | number>,
): Promise<void> {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`
  const correlationId = crypto.randomUUID()
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage)
      reject(new ForesightExecutionError('FORESIGHT_MAIN_TIMEOUT'))
    }, 15_000)
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== location.origin ||
        !event.data || typeof event.data !== 'object' || event.data.channel !== MAIN_CHANNEL ||
        !event.data.payload || typeof event.data.payload !== 'object' ||
        event.data.payload.token !== token || event.data.payload.correlationId !== correlationId) return
      const payload = event.data.payload as Record<string, unknown>
      if (payload.type !== 'FORESIGHT_MAIN_DONE' && payload.type !== 'FORESIGHT_MAIN_FAILED') return
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      if (payload.type === 'FORESIGHT_MAIN_DONE') resolve()
      else reject(new ForesightExecutionError(
        typeof payload.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(payload.code)
          ? payload.code : 'FORESIGHT_MAIN_FAILED',
      ))
    }
    window.addEventListener('message', onMessage)
    window.postMessage({
      channel: MAIN_CHANNEL,
      payload: { type, token, correlationId, values },
    }, location.origin)
  })
}

async function captureReportInMainWorld(): Promise<ForesightExecutionDocument> {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`
  const correlationId = crypto.randomUUID()
  return new Promise<ForesightExecutionDocument>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage)
      reject(new ForesightExecutionError('FORESIGHT_REPORT_TIMEOUT'))
    }, 125_000)
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== location.origin ||
        !event.data || typeof event.data !== 'object' || event.data.channel !== MAIN_CHANNEL ||
        !event.data.payload || typeof event.data.payload !== 'object' ||
        event.data.payload.token !== token || event.data.payload.correlationId !== correlationId) return
      const payload = event.data.payload as Record<string, unknown>
      if (payload.type !== 'FORESIGHT_MAIN_REPORT' && payload.type !== 'FORESIGHT_MAIN_FAILED') return
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      if (payload.type === 'FORESIGHT_MAIN_FAILED') {
        reject(new ForesightExecutionError(
          typeof payload.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(payload.code)
            ? payload.code : 'FORESIGHT_MAIN_FAILED',
        ))
        return
      }
      if (payload.contentType !== 'application/pdf' || typeof payload.pdfBase64 !== 'string' ||
        payload.pdfBase64.length < 8 || payload.pdfBase64.length > 35_000_000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.pdfBase64)) {
        reject(new ForesightExecutionError('FORESIGHT_REPORT_RESPONSE_INVALID'))
        return
      }
      resolve({ contentType: 'application/pdf', pdfBase64: payload.pdfBase64 })
    }
    window.addEventListener('message', onMessage)
    window.postMessage({
      channel: MAIN_CHANNEL,
      payload: { type: 'CAPTURE_REPORT', token, correlationId, values: {} },
    }, location.origin)
  })
}

function decodePdf(document: ForesightExecutionDocument): Uint8Array {
  let binary: string
  try {
    binary = atob(document.pdfBase64)
  } catch {
    return fail('FORESIGHT_REPORT_RESPONSE_INVALID')
  }
  if (binary.length < 5 || binary.length > 25 * 1024 * 1024 || !binary.startsWith('%PDF-')) {
    fail('FORESIGHT_REPORT_RESPONSE_INVALID')
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer))
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function setSelectText(doc: Document, id: string, text: string): void {
  const element = select(doc, id)
  const option = [...element.options].find((candidate) => candidate.text.trim() === text)
  if (!option) fail('FORESIGHT_SCHEMA_MISMATCH')
  element.value = option.value
  emitChange(element)
  if (selectedText(element) !== text) fail('FORESIGHT_WRITE_MISMATCH')
}

function validateSurface(doc: Document, path: string): void {
  const validation = validateForesightSurface({
    path,
    fieldIds: [...doc.querySelectorAll('[id]')].map((element) => element.id),
  })
  if (!validation.ok) fail(validation.code)
}

function currentRelease(): string {
  const release = parseForesightRelease({
    visibleText: document.body?.innerText ?? '',
    scriptUrls: [...document.scripts].map((script) => script.src).filter(Boolean),
  })
  return release ?? fail('FORESIGHT_RELEASE_UNAPPROVED')
}

async function openFlexLife(snapshot: ForesightIllustrationSnapshot): Promise<{
  doc: Document
  existing: boolean
}> {
  const start = await waitForFrame('/NWI/Main/StartPage.aspx')
  const existing = [...start.querySelectorAll<HTMLAnchorElement>('a')]
    .filter((link) => link.textContent?.trim() === snapshot.carrierCaseName)
  if (existing.length > 1) fail('FORESIGHT_CASE_AMBIGUOUS')
  if (existing.length === 1) {
    const link = existing[0]!
    if (!link.href.startsWith('javascript:__doPostBack(') ||
      !link.getAttribute('onclick')?.includes(`'${snapshot.carrierCaseName}'`)) {
      fail('FORESIGHT_CASE_LINK_INVALID')
    }
    link.click()
    await waitFor(() => framePath(MAIN_FRAME_ID) !== '/NWI/Main/StartPage.aspx' ? true : null,
      'FORESIGHT_NAVIGATION_TIMEOUT')
    return { doc: await navigate('/NWI/IUL2025/client.aspx', MENU_IDS.client), existing: true }
  }
  click(document, NEW_ILLUSTRATION_ID)
  const modal = await waitForFrame('/NWI/Main/ProductSelectionDialog.aspx', MODAL_FRAME_ID)
  setSelectText(modal, PRODUCT_SELECTION.jurisdiction, STATE_NAMES[snapshot.insured.issueState] ?? fail('FORESIGHT_STATE_UNSUPPORTED'))
  setSelectText(modal, PRODUCT_SELECTION.productType, 'Any')
  setSelectText(modal, PRODUCT_SELECTION.salesConcept, 'Basic Illustration')
  const product = modal.getElementById(FLEX_LIFE_ID)
  if (product?.tagName !== 'A' || product.textContent?.trim() !== 'FlexLife') {
    fail('FORESIGHT_PRODUCT_UNAVAILABLE')
  }
  product.click()
  return { doc: await waitForFrame('/NWI/IUL2025/client.aspx'), existing: false }
}

function readClient(doc: Document, snapshot: ForesightIllustrationSnapshot): Pick<ForesightMaterialReadback,
  'firstName' | 'lastName' | 'dateOfBirth' | 'issueState' | 'gender' | 'rateClass'> {
  validateSurface(doc, '/NWI/IUL2025/client.aspx')
  const expectedState = STATE_NAMES[snapshot.insured.issueState]
  return {
    firstName: input(doc, FORESIGHT_FLEXLIFE_FIELDS.client.firstName).value,
    lastName: input(doc, FORESIGHT_FLEXLIFE_FIELDS.client.lastName).value,
    dateOfBirth: input(doc, FORESIGHT_FLEXLIFE_FIELDS.client.birthDate).value,
    issueState: selectedText(select(doc, FORESIGHT_FLEXLIFE_FIELDS.client.jurisdiction)) === expectedState
      ? snapshot.insured.issueState : 'MISMATCH',
    gender: selectedText(select(doc, FORESIGHT_FLEXLIFE_FIELDS.client.gender)),
    rateClass: selectedText(select(doc, FORESIGHT_FLEXLIFE_FIELDS.client.riskClass)) === 'Standard Non-Tobacco'
      ? 'Standard_NT' : selectedText(select(doc, FORESIGHT_FLEXLIFE_FIELDS.client.riskClass)) === 'Standard Tobacco'
        ? 'Standard_Tobacco' : 'MISMATCH',
  }
}

async function fillClient(doc: Document, snapshot: ForesightIllustrationSnapshot): Promise<Pick<ForesightMaterialReadback,
  'firstName' | 'lastName' | 'dateOfBirth' | 'issueState' | 'gender' | 'rateClass'>> {
  validateSurface(doc, '/NWI/IUL2025/client.aspx')
  const target = {
    firstName: snapshot.insured.firstName,
    lastName: snapshot.insured.lastName,
    dateOfBirth: foresightClientBirthDate(snapshot.insured.dateOfBirth),
    issueState: snapshot.insured.issueState,
    gender: snapshot.underwriting.gender,
    rateClass: snapshot.underwriting.rateClass,
  }
  const rateText = target.rateClass === 'Standard_NT' ? 'Standard Non-Tobacco' : 'Standard Tobacco'
  await applyInMainWorld('APPLY_CLIENT', {
    jurisdiction: optionValue(doc, FORESIGHT_FLEXLIFE_FIELDS.client.jurisdiction, STATE_NAMES[target.issueState]!),
    firstName: target.firstName,
    lastName: target.lastName,
    gender: optionValue(doc, FORESIGHT_FLEXLIFE_FIELDS.client.gender, target.gender),
    birthDate: target.dateOfBirth,
    riskClass: optionValue(doc, FORESIGHT_FLEXLIFE_FIELDS.client.riskClass, rateText),
  })
  doc = await waitForFrame('/NWI/IUL2025/client.aspx')
  await waitFor(() => input(doc, FORESIGHT_FLEXLIFE_FIELDS.client.firstName).value === target.firstName &&
    input(doc, FORESIGHT_FLEXLIFE_FIELDS.client.lastName).value === target.lastName &&
    input(doc, FORESIGHT_FLEXLIFE_FIELDS.client.birthDate).value === target.dateOfBirth ? true : null,
  'FORESIGHT_CLIENT_READBACK_TIMEOUT')
  return readClient(doc, snapshot)
}

async function navigate(path: string, menuId: string): Promise<Document> {
  click(document, menuId)
  return waitForFrame(path)
}

async function fillLedger(doc: Document, snapshot: ForesightIllustrationSnapshotV1): Promise<Pick<ForesightMaterialReadback,
  'solveMethod' | 'solveAmount' | 'faceAmount' | 'premiumMode' | 'premiumAmount' | 'deathBenefitOption'>> {
  validateSurface(doc, '/NWI/IUL2025/ledger.aspx')
  const target = buildForesightTarget(snapshot)
  const optionText = target.deathBenefitOption === 'A_Level' ? 'A (Level)' : 'B (Increasing)'
  await applyInMainWorld('APPLY_LEDGER', {
    faceAmount: target.faceAmount,
    premiumAmount: target.premiumAmount,
    deathBenefitOption: optionValue(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.deathBenefitOption, optionText),
  })
  doc = await waitForFrame('/NWI/IUL2025/ledger.aspx')
  await waitFor(() => carrierAmountEquals(
    input(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.deathBenefitAmount).value,
    target.faceAmount,
  ) ? true : null, 'FORESIGHT_FACE_AMOUNT_WRITE_MISMATCH')
  await waitFor(() => carrierAmountEquals(
    input(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.premiumAmount).value,
    target.premiumAmount,
  ) ? true : null, 'FORESIGHT_PREMIUM_WRITE_MISMATCH')
  return readLedger(doc)
}

function readLedger(doc: Document): Pick<ForesightMaterialReadback,
  'solveMethod' | 'solveAmount' | 'faceAmount' | 'premiumMode' | 'premiumAmount' | 'deathBenefitOption'> {
  validateSurface(doc, '/NWI/IUL2025/ledger.aspx')
  const faceAmount = input(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.deathBenefitAmount).value
  const deathBenefitType = selectedText(select(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.deathBenefitType))
  const premiumType = selectedText(select(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.premiumType))
  return {
    solveMethod: deathBenefitType === 'Specify Amount' && premiumType === 'Specify Amount'
      ? 'Specify_Amount' : 'MISMATCH',
    solveAmount: faceAmount,
    faceAmount,
    premiumMode: selectedText(select(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.premiumMode)) as 'Monthly',
    premiumAmount: input(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.premiumAmount).value,
    deathBenefitOption: selectedText(select(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.deathBenefitOption)) === 'A (Level)'
      ? 'A_Level' : 'B_Increasing',
  }
}

type ForesightSolvedLedgerReadback = {
  faceSolve: string
  premiumSolve: string
  faceAmount: number | null
  monthlyPremium: number
  annualPremium: number
  premiumMode: string
  deathBenefitOption: string
}

function carrierAmount(value: string): number | null {
  const normalized = value.replace(/[^0-9.-]/g, '')
  if (!/\d/.test(normalized)) return null
  const amount = Number(normalized)
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

export function carrierSummaryAmount(
  rows: ReadonlyArray<readonly [string, string]>,
  label: string,
): number | null {
  const value = rows.find(([candidate]) => candidate.trim() === label)?.[1] ?? ''
  return carrierAmount(value)
}

function solvedSummaryRows(): Array<[string, string]> {
  const summary = globalThis.document.getElementById('ctl00_mobilityPH_quickCalc_BodySection')
  return [...(summary?.querySelectorAll('tr') ?? [])].flatMap((row) => {
    const cells = row.querySelectorAll('td')
    return cells.length >= 2
      ? [[cells[0]?.textContent ?? '', cells[1]?.textContent ?? ''] as [string, string]]
      : []
  })
}

export function monthlyPremiumFromAnnual(annualPremium: number): number | null {
  if (!Number.isFinite(annualPremium) || annualPremium <= 0) return null
  return Math.round((annualPremium / 12) * 100) / 100
}

function solvedAnnualPremium(): number | null {
  return carrierSummaryAmount(solvedSummaryRows(), 'Premium:')
}

function solvedFaceAmount(doc: Document): number | null {
  return carrierAmount(input(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.deathBenefitAmount).value)
}

function solvedMonthlyPremium(doc: Document): number | null {
  const scheduled = carrierAmount(input(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.premiumAmount).value)
  if (scheduled !== null) return scheduled
  const annualPremium = solvedAnnualPremium()
  return annualPremium === null ? null : monthlyPremiumFromAnnual(annualPremium)
}

function selectedSolveRadio(doc: Document, marker: string): string {
  const selected = [...doc.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    .filter((radio) => (radio.id.includes(marker) || radio.name.includes(marker)) && radio.checked)
  if (selected.length !== 1) fail('FORESIGHT_SCHEMA_MISMATCH')
  const radio = selected[0]!
  return foresightSolveLabel(marker, radio.value) ?? fail('FORESIGHT_SCHEMA_MISMATCH')
}

function hasCarrierCalculationError(doc: Document): boolean {
  return /Calculations Unavailable|The illustration has errors/i.test(doc.body?.innerText ?? '')
}

function readSolvedLedger(doc: Document): ForesightSolvedLedgerReadback | null {
  validateSurface(doc, '/NWI/IUL2025/ledger.aspx')
  const faceAmount = solvedFaceAmount(doc)
  const monthlyPremium = solvedMonthlyPremium(doc)
  const annualPremium = solvedAnnualPremium()
  if (monthlyPremium === null || annualPremium === null) return null
  return {
    faceSolve: selectedSolveRadio(doc, 'rdoDeathBenefitSolves'),
    premiumSolve: selectedSolveRadio(doc, 'rdoPremiumSolves'),
    faceAmount,
    monthlyPremium,
    annualPremium,
    premiumMode: selectedText(select(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.premiumMode)),
    deathBenefitOption: selectedText(select(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.deathBenefitOption)),
  }
}

function expectedDeathBenefitOption(snapshot: ForesightSolvedIllustrationSnapshotV2): string {
  return snapshot.deathBenefitOption === 'A_Level' ? 'A (Level)' : 'B (Increasing)'
}

export function quickViewInitialFaceAmount(rows: ReadonlyArray<ReadonlyArray<string>>): number | null {
  const headerIndex = rows.findIndex((row) => row.some((cell) => quickViewLabel(cell) === 'Initial Face Amount'))
  if (headerIndex < 0) return null
  const faceColumn = rows[headerIndex]!.findIndex((cell) => quickViewLabel(cell) === 'Initial Face Amount')
  return carrierAmount(rows[headerIndex + 1]?.[faceColumn] ?? '')
}

function quickViewLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function quickViewNumber(value: string, allowZero = true): number | null {
  const normalized = value.replace(/[^0-9.-]/g, '')
  if (!/\d/.test(normalized)) return null
  const amount = Number(normalized)
  return Number.isFinite(amount) && (allowZero ? amount >= 0 : amount > 0) ? amount : null
}

/// Every column Quick View may render in the summary table. Used only to score
/// header candidates — an unknown column is ignored, not rejected.
const QUICK_VIEW_SUMMARY_COLUMNS = [
  'Initial Face Amount', 'Lapse Year', 'MEC Year', 'Modal Premium', 'Premium Mode',
  'Minimum Premium', 'Death Benefit Protection Premium', 'Target Premium',
  'MEC Premium', 'Guideline Level Premium', 'Guideline Single Premium',
]

/// Every column Quick View may render in the annual projection. Used only to
/// score header candidates — an unknown column is ignored, not rejected.
const QUICK_VIEW_ANNUAL_COLUMNS = [
  'Policy Year', 'Age', 'Premium Outlay', 'Weighted Average Interest Rate',
  'Loan', 'Annual Income', 'Accumulated Value', 'Cash Surrender Value',
  'Net Death Benefit',
]

export function parseForesightQuickReview(
  rows: ReadonlyArray<ReadonlyArray<string>>,
): ForesightQuickReview | null {
  // Located by the one column the summary always carries. It used to require a
  // target premium beside it, and the table was never found when that column
  // was not in the same row — so the whole Quick View was discarded. A captura
  // de produção mostra por quê: o target premium existe, num bloco seguinte.
  // Among the candidates the richest wins, so a narrower table that happens to
  // name a face amount cannot displace the summary.
  const summaryHeaderIndex = rows
    .map((row, index) => ({ index, row }))
    .filter(({ row }) => row.some((cell) => quickViewLabel(cell) === 'Initial Face Amount'))
    .map(({ index, row }) => ({
      index,
      known: row.filter((cell) => QUICK_VIEW_SUMMARY_COLUMNS.includes(quickViewLabel(cell))).length,
    }))
    .sort((left, right) => right.known - left.known)[0]?.index ?? -1

  // O resumo não é um cabeçalho com uma linha de valores embaixo: são vários
  // pares empilhados. Medido em produção, um FlexLife resolvido pelo capital
  // rende três — face/lapse/MEC/modal/modo, depois MMP/MGP/target/MEC
  // premium/guideline level, e por fim guideline single sozinho.
  //
  // Ler só o par ancorado em `Initial Face Amount` deixava seis campos para
  // trás, entre eles o Target Premium — que a página imprime, ao contrário do
  // que este arquivo afirmava. A tela mostrava um traço onde havia US$ 6.786.
  //
  // Cada rótulo conhecido é procurado em todos os pares, e o primeiro que o
  // traz responde. Um rótulo que não aparece em par nenhum continua nulo, que
  // é o caso legítimo de coluna que a seguradora não renderiza.
  const summaryPairs: Array<{ headers: ReadonlyArray<string>; values: ReadonlyArray<string> }> = []
  for (let index = 0; index < rows.length - 1; index += 1) {
    const row = rows[index] ?? []
    if (!row.some((cell) => QUICK_VIEW_SUMMARY_COLUMNS.includes(quickViewLabel(cell)))) continue
    // Um cabeçalho nomeia colunas; a linha seguinte carrega os valores delas.
    // Sem esta guarda, a própria linha de valores viraria candidata a cabeçalho
    // do par seguinte quando dois blocos se encostam.
    if (index > 0) {
      const previous = rows[index - 1] ?? []
      if (previous.some((cell) => QUICK_VIEW_SUMMARY_COLUMNS.includes(quickViewLabel(cell)))) continue
    }
    summaryPairs.push({ headers: row, values: rows[index + 1] ?? [] })
  }
  const summaryValue = (label: string, allowZero = true) => {
    for (const pair of summaryPairs) {
      const index = pair.headers.findIndex((cell) => quickViewLabel(cell) === label)
      if (index < 0) continue
      const value = quickViewNumber(pair.values[index] ?? '', allowZero)
      if (value !== null) return value
    }
    return null
  }
  const initialFaceAmount = summaryValue('Initial Face Amount', false)
  const modalPremium = summaryValue('Modal Premium', false)
  const targetPremium = summaryValue('Target Premium', false)
  // The face amount and the modal premium are what tie this table to the case
  // the ledger just confirmed, so both are still required. The target premium
  // is reported when the carrier prints it and null when it does not.
  if (initialFaceAmount === null || modalPremium === null) return null

  // Which columns Quick View renders depends on the product and on what the
  // illustration was solved for: a case with no loan and no income leaves those
  // columns out of the table entirely. Demanding all nine meant one absent
  // column discarded the whole projection — and because the caller treats a
  // null read-back as a mismatch, the generation failed rather than returning
  // the eight columns that were right there.
  //
  // So the year and the age are required, because a row that cannot say which
  // year it is is not a row, and every other column is optional and arrives as
  // null when the carrier did not render it. The header row is still located by
  // the columns it must have, and among the candidates the richest one wins, so
  // a stray table that happens to carry a "Policy Year" cell cannot displace
  // the projection.
  const annualHeaderCandidates = rows
    .map((row, index) => ({ index, row }))
    .filter(({ row }) =>
      row.some((cell) => quickViewLabel(cell) === 'Policy Year') &&
      row.some((cell) => quickViewLabel(cell) === 'Age'))
    .map(({ index, row }) => ({
      index,
      known: row.filter((cell) => QUICK_VIEW_ANNUAL_COLUMNS.includes(quickViewLabel(cell))).length,
    }))
    .sort((left, right) => right.known - left.known)
  const annualHeaderIndex = annualHeaderCandidates[0]?.index ?? -1
  if (annualHeaderIndex < 0) return null
  const annualHeaders = rows[annualHeaderIndex] ?? []
  const annualIndex = (label: string) => annualHeaders.findIndex((cell) => quickViewLabel(cell) === label)
  const indexes = {
    policyYear: annualIndex('Policy Year'),
    age: annualIndex('Age'),
    premiumOutlay: annualIndex('Premium Outlay'),
    weightedAverageInterestRate: annualIndex('Weighted Average Interest Rate'),
    loan: annualIndex('Loan'),
    annualIncome: annualIndex('Annual Income'),
    accumulatedValue: annualIndex('Accumulated Value'),
    cashSurrenderValue: annualIndex('Cash Surrender Value'),
    netDeathBenefit: annualIndex('Net Death Benefit'),
  }
  if (indexes.policyYear < 0 || indexes.age < 0) return null
  const annualProjection = rows.slice(annualHeaderIndex + 1, annualHeaderIndex + 122).flatMap((row) => {
    const policyYear = quickViewNumber(row[indexes.policyYear] ?? '')
    const age = quickViewNumber(row[indexes.age] ?? '')
    if (policyYear === null || age === null || !Number.isInteger(policyYear) || !Number.isInteger(age)) return []
    return [{
      policyYear,
      age,
      premiumOutlay: quickViewNumber(row[indexes.premiumOutlay] ?? ''),
      weightedAverageInterestRate: quickViewNumber(row[indexes.weightedAverageInterestRate] ?? ''),
      loan: quickViewNumber(row[indexes.loan] ?? ''),
      annualIncome: quickViewNumber(row[indexes.annualIncome] ?? ''),
      accumulatedValue: quickViewNumber(row[indexes.accumulatedValue] ?? ''),
      cashSurrenderValue: quickViewNumber(row[indexes.cashSurrenderValue] ?? ''),
      netDeathBenefit: quickViewNumber(row[indexes.netDeathBenefit] ?? ''),
    }]
  })
  if (annualProjection.length < 1) return null
  return {
    summary: {
      initialFaceAmount,
      lapseYear: summaryValue('Lapse Year'),
      mecYear: summaryValue('MEC Year'),
      modalPremium,
      minimumPremium: summaryValue('Minimum Premium (MMP)'),
      deathBenefitProtectionPremium: summaryValue('Death Benefit Protection Premium (MGP)'),
      targetPremium,
      mecPremium: summaryValue('MEC Premium'),
      guidelineLevelPremium: summaryValue('Guideline Level Premium'),
      guidelineSinglePremium: summaryValue('Guideline Single Premium'),
    },
    annualProjection,
  }
}

/// Either the Quick View, or why it could not be read.
///
/// The failure used to be a bare null, and a bare null is what made this
/// undiagnosable: the generation carried on without a projection and nothing
/// recorded which column the reader had been waiting for.
export type QuickViewReading =
  | { review: ForesightQuickReview }
  | { unavailable: ForesightQuickReviewUnavailable }

/// The labels of a header row, so a reader can see what the carrier rendered.
/// Labels only — the value rows underneath belong to the insured.
function headerLabels(
  rows: ReadonlyArray<ReadonlyArray<string>>, anchor: string,
): string[] {
  const row = rows.find((candidate) => candidate.some((cell) => quickViewLabel(cell) === anchor))
  return (row ?? []).map((cell) => quickViewLabel(cell).slice(0, 64)).filter((cell) => cell !== '')
    .slice(0, 24)
}

/// Quantas vezes voltar ao Quick View antes de desistir dele.
///
/// A tela não acompanha o caso na hora. Duas gerações seguidas leram dali o
/// mesmo prêmio modal — 287,96 — enquanto o ledger dizia 288,00 e depois
/// 113,08: era o caso anterior ainda na tela. Ler uma vez só e concluir que a
/// seguradora se contradiz é confundir atraso com contradição.
const QUICK_VIEW_ATTEMPTS = 4
const QUICK_VIEW_RETRY_MS = 1_500

/// Volta ao Quick View até ele falar do caso que o ledger acabou de confirmar.
///
/// Insistir só pode transformar uma projeção ausente em presente, nunca o
/// contrário: a conferência de identidade continua estrita, e o que sai daqui
/// ou é o Quick View deste cenário ou é o motivo de não haver um.
async function readQuickViewForCase(
  ledger: Pick<ForesightSolvedLedgerReadback, 'faceAmount' | 'monthlyPremium'>,
): Promise<QuickViewReading> {
  let last: QuickViewReading = {
    unavailable: { reason: 'NOT_ON_PAGE', summaryLabels: [], projectionLabels: [], comparison: null },
  }
  for (let attempt = 0; attempt < QUICK_VIEW_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, QUICK_VIEW_RETRY_MS))
    last = readQuickView(await navigate('/NWI/IUL2025/quickview.aspx', MENU_IDS.quickView))
    if ('review' in last && quickReviewMatchesLedger(last.review, ledger)) return last
  }
  return last
}

function readQuickView(doc: Document): QuickViewReading {
  if (doc.location.pathname !== '/NWI/IUL2025/quickview.aspx') {
    return {
      unavailable: {
        reason: 'NOT_ON_PAGE', summaryLabels: [], projectionLabels: [], comparison: null,
      },
    }
  }
  const rows = [...doc.querySelectorAll('tr')].map((row) =>
    [...row.querySelectorAll('th, td')].map((cell) => cell.textContent?.trim() ?? ''))
  const review = parseForesightQuickReview(rows)
  if (!review) {
    return {
      unavailable: {
        reason: 'UNREADABLE',
        summaryLabels: headerLabels(rows, 'Initial Face Amount'),
        projectionLabels: headerLabels(rows, 'Policy Year'),
        comparison: null,
      },
    }
  }
  return {
    review: {
      ...review,
      evidence: {
        source: 'FORESIGHT_QUICK_VIEW',
        observedAt: new Date().toISOString(),
        sourceRows: rows.slice(0, 150).map((row) => row.slice(0, 20).map((cell) => cell.slice(0, 256))),
      },
    },
  }
}

/// Quanto os dois prêmios mensais podem diferir e ainda serem o mesmo caso.
///
/// Eles não são a mesma grandeza, e a diferença é derivável. A seguradora
/// publica o anual arredondado ao dólar e o modal ao centavo; nós dividimos o
/// anual por doze. Num caso real: modal 287,96, que vezes doze dá 3.455,52,
/// que ela publica como 3.456, que dividido por doze nos dá 288,00. Os quatro
/// centavos são exatamente 0,48/12 — o arredondamento do anual espalhado pelos
/// meses. O teto de cinco centavos é esse limite, não um número escolhido para
/// caber.
///
/// Houve uma tentativa de meio dólar, revertida, e esta é a correção dela. Na
/// época eu tinha uma geração com quatro centavos e outra com cento e setenta e
/// cinco dólares, e li as duas como o mesmo fenômeno. Uma terceira geração
/// reproduziu os quatro centavos no mesmo cenário: é sistemático. A de cento e
/// setenta e cinco era outro caso, e um teto de centavos a recusa igual.
const MODAL_PREMIUM_TOLERANCE = 0.05

export function quickReviewMatchesLedger(
  review: ForesightQuickReview,
  ledger: Pick<ForesightSolvedLedgerReadback, 'faceAmount' | 'monthlyPremium'>,
): boolean {
  if (ledger.faceAmount === null) return false
  // O capital continua exato: é inteiro, as duas telas mostram igual, e ali
  // uma diferença é sempre outro cenário.
  return carrierAmountEquals(review.summary.initialFaceAmount, ledger.faceAmount) &&
    Math.abs(review.summary.modalPremium - ledger.monthlyPremium) <= MODAL_PREMIUM_TOLERANCE
}

export function solvedLedgerMatches(
  snapshot: ForesightSolvedIllustrationSnapshotV2,
  observed: ForesightSolvedLedgerReadback,
): boolean {
  if (observed.premiumMode !== 'Monthly' || observed.deathBenefitOption !== expectedDeathBenefitOption(snapshot)) {
    return false
  }
  if (Math.abs(observed.annualPremium - (observed.monthlyPremium * 12)) > 0.06) return false
  if (snapshot.solve.basis === 'PREMIUM') {
    const expected = ({
      Minimum_DB_Max_Cash_Value: 'Minimum DB/Max Cash Value',
      Balanced_DB: 'Balanced DB',
      Based_on_Target_Premium: 'Based on Target Premium',
    } as Record<string, string>)[snapshot.solve.method]
    return expected !== undefined && observed.faceSolve === expected && observed.premiumSolve === 'None'
  }
  const expected = ({
    Protection_Focus: 'Protection Focus',
    Retirement_Focus: 'Retirement Focus',
  } as Record<string, string>)[snapshot.solve.method]
  return expected !== undefined && observed.faceSolve === 'None' && observed.premiumSolve === expected
}

async function fillSolvedLedger(
  doc: Document,
  snapshot: ForesightSolvedIllustrationSnapshotV2,
): Promise<ForesightSolvedLedgerReadback & { faceAmount: number }> {
  validateSurface(doc, '/NWI/IUL2025/ledger.aspx')
  const values: Record<string, string | number> = {
    solveBasis: snapshot.solve.basis,
    solveMethod: snapshot.solve.method,
    deathBenefitOption: optionValue(
      doc,
      FORESIGHT_FLEXLIFE_FIELDS.ledger.deathBenefitOption,
      expectedDeathBenefitOption(snapshot),
    ),
    ...(snapshot.solve.basis === 'PREMIUM'
      ? { premiumAmount: snapshot.solve.amount }
      : { faceAmount: snapshot.solve.amount }),
  }
  await applyInMainWorld('APPLY_LEDGER_SOLVE', values)
  doc = await waitForFrame('/NWI/IUL2025/ledger.aspx')
  try {
    const observed = await waitFor(() => {
      if (hasCarrierCalculationError(doc)) return null
      const observed = readSolvedLedger(doc)
      return observed && solvedLedgerMatches(snapshot, observed) ? observed : null
    }, 'FORESIGHT_SOLVE_READBACK_TIMEOUT', 30_000)
    if (observed.faceAmount !== null) return { ...observed, faceAmount: observed.faceAmount }
    if (snapshot.solve.basis !== 'PREMIUM') fail('FORESIGHT_SOLVE_READBACK_MISMATCH')
    const quickView = await navigate('/NWI/IUL2025/quickview.aspx', MENU_IDS.quickView)
    const reading = readQuickView(quickView)
    const faceAmount = 'review' in reading ? reading.review.summary.initialFaceAmount : null
    if (faceAmount === null) fail('FORESIGHT_SOLVE_READBACK_MISMATCH')
    return { ...observed, faceAmount }
  } catch (error) {
    if (hasCarrierCalculationError(doc)) fail('FORESIGHT_CALCULATION_UNAVAILABLE')
    throw error
  }
}

function verifyRiders(doc: Document): string[] {
  const expected: Array<[keyof typeof RIDER_FIELDS, 'Yes' | 'No']> = [
    ['BalanceSheetBenefit', 'No'], ['BenefitDistributionOption', 'No'], ['ChildTerm', 'No'],
    ['DeathBenefitProtection', 'Yes'], ['GuaranteedInsurability', 'No'], ['WaiverOfPremium', 'No'],
    ['PremiumChronicCare', 'No'], ['ABRTerminalIllness', 'Yes'], ['ABRChronicIllness', 'Yes'],
    ['ABRCriticalIllness', 'Yes'], ['ABRCriticalInjury', 'Yes'], ['ABRAlzheimersDisease', 'Yes'],
  ]
  for (const [key, value] of expected) {
    if (selectedText(select(doc, RIDER_FIELDS[key])) !== value) fail('FORESIGHT_RIDER_DEFAULT_MISMATCH')
  }
  return expected.filter(([, value]) => value === 'Yes').map(([key]) => key)
}

function verifyReports(doc: Document): string[] {
  if (doc.location.pathname !== '/NWI/ProductWorkflow/reportselection.aspx' ||
    !doc.body?.innerText.includes('NAIC Illustration')) fail('FORESIGHT_REPORT_SELECTION_MISMATCH')
  const selectedGroups = [...doc.querySelectorAll<HTMLInputElement>('input[type="checkbox"][id$="_chkGroup"]')]
    .filter((checkbox) => checkbox.checked)
  if (selectedGroups.length !== 1 || selectedGroups[0]?.id !== NAIC_REPORT_GROUP_ID) {
    fail('FORESIGHT_REPORT_SELECTION_MISMATCH')
  }
  return ['NAIC_ILLUSTRATION']
}

async function fillAllocation(doc: Document): Promise<Array<{ strategy: string; percentage: number }>> {
  await applyInMainWorld('APPLY_ALLOCATION', {})
  doc = await waitForFrame('/NWI/IUL2025/InterestRates.aspx')
  return readAllocation(doc)
}

function readAllocation(doc: Document): Array<{ strategy: string; percentage: number }> {
  const values = Object.fromEntries(Object.entries(ALLOCATION_FIELDS).map(([key, id]) => [key, input(doc, id).value]))
  if (values.capFocus !== '100' || values.total !== '100' ||
    Object.entries(values).some(([key, value]) => key !== 'capFocus' && key !== 'total' && value !== '0')) {
    fail('FORESIGHT_ALLOCATION_READBACK_MISMATCH')
  }
  return [{ strategy: 'SP500PointToPointCapFocus', percentage: 100 }]
}

async function saveCase(caseName: string): Promise<void> {
  click(document, SAVE_AS_ID)
  const modal = await waitForFrame('/NWI/Main/SaveDialog.aspx', MODAL_FRAME_ID)
  setInput(modal, SAVE_NAME_ID, caseName)
  setSelectText(modal, SAVE_FOLDER_ID, 'My Cases')
  click(modal, SAVE_CONFIRM_ID)
  const outcome = await waitFor(() => {
    const doc = frameDocument(MODAL_FRAME_ID)
    if (!doc || !frame(MODAL_FRAME_ID).getAttribute('src')) return 'SAVED'
    if (doc.body?.innerText.includes('Duplicate Name')) return 'DUPLICATE'
    return null
  }, 'FORESIGHT_SAVE_TIMEOUT')
  if (outcome === 'DUPLICATE') fail('FORESIGHT_DUPLICATE_CASE')
  await waitFor(() => document.body?.innerText.includes(caseName), 'FORESIGHT_SAVE_READBACK_FAILED')
}

async function executeForesightIllustrationV1(input: {
  inputHash: string
  snapshot: ForesightIllustrationSnapshotV1
  onProgress?: ProgressReporter
}): Promise<{ receipt: ForesightExecutionReceipt; document: ForesightExecutionDocument }> {
  if (classifyForesightLocation(location.href) !== 'FORESIGHT' ||
    location.pathname !== '/NWI/Main/Layout.aspx') fail('FORESIGHT_LOCATION_UNEXPECTED')
  const independentHash = await sha256ForesightSnapshot(input.snapshot)
  if (independentHash !== input.inputHash) fail('FORESIGHT_INPUT_HASH_MISMATCH')
  const release = currentRelease()
  input.onProgress?.('OPENING_CASE')
  const opened = await openFlexLife(input.snapshot)
  input.onProgress?.('FILLING_CLIENT')
  const client = opened.existing ? readClient(opened.doc, input.snapshot) : await fillClient(opened.doc, input.snapshot)
  input.onProgress?.('CONFIGURING_PRODUCT')
  const ledgerDoc = await navigate('/NWI/IUL2025/ledger.aspx', MENU_IDS.ledger)
  const ledger = opened.existing ? readLedger(ledgerDoc) : await fillLedger(ledgerDoc, input.snapshot)
  const ridersDoc = await navigate('/NWI/IUL2025/product.aspx', MENU_IDS.riders)
  const riders = verifyRiders(ridersDoc)
  const ratesDoc = await navigate('/NWI/IUL2025/InterestRates.aspx', MENU_IDS.interestRates)
  const allocations = opened.existing ? readAllocation(ratesDoc) : await fillAllocation(ratesDoc)
  const reportsDoc = await navigate('/NWI/ProductWorkflow/reportselection.aspx', MENU_IDS.reports)
  const reports = verifyReports(reportsDoc)
  const target = buildForesightTarget(input.snapshot)
  input.onProgress?.('VERIFYING_VALUES')
  const observed: ForesightMaterialReadback = {
    carrierCaseName: target.carrierCaseName,
    productCode: '956',
    reports,
    ...client,
    ...ledger,
    allocations,
    riders,
  }
  const comparison = compareForesightTarget(input.snapshot, observed)
  if (!comparison.ok) fail(foresightReadbackMismatchCode(comparison.mismatches))
  if (!opened.existing) {
    input.onProgress?.('SAVING_CASE')
    await saveCase(target.carrierCaseName)
  }
  input.onProgress?.('GENERATING_PDF')
  const document = await captureReportInMainWorld()
  const pdf = decodePdf(document)
  const receipt: ForesightExecutionReceipt = {
    inputHash: independentHash,
    caseFingerprint: await deterministicCaseFingerprint(input.snapshot),
    carrierCaseName: target.carrierCaseName,
    productCode: '956',
    release,
    reportCode: 'NAIC_ILLUSTRATION',
    documentSha256: await sha256Hex(pdf),
    documentBytes: pdf.byteLength,
    saved: true,
  }
  return { receipt, document }
}

export function solvedClientMatches(
  snapshot: ForesightSolvedIllustrationSnapshotV2,
  client: Pick<ForesightMaterialReadback,
    'firstName' | 'lastName' | 'dateOfBirth' | 'issueState' | 'gender' | 'rateClass'>,
): boolean {
  const expectedDate = foresightClientBirthDate(snapshot.insured.dateOfBirth)
  return client.firstName === snapshot.insured.firstName && client.lastName === snapshot.insured.lastName &&
    client.dateOfBirth === expectedDate && client.issueState === snapshot.insured.issueState &&
    client.gender === snapshot.underwriting.gender && client.rateClass === snapshot.underwriting.rateClass
}

async function executeForesightSolvedIllustration(input: {
  inputHash: string
  snapshot: ForesightSolvedIllustrationSnapshotV2
  onProgress?: ProgressReporter
}): Promise<{ receipt: ForesightSolvedExecutionReceipt; document: ForesightExecutionDocument }> {
  if (classifyForesightLocation(location.href) !== 'FORESIGHT' ||
    location.pathname !== '/NWI/Main/Layout.aspx') fail('FORESIGHT_LOCATION_UNEXPECTED')
  const independentHash = await sha256ForesightSnapshot(input.snapshot)
  if (independentHash !== input.inputHash) fail('FORESIGHT_INPUT_HASH_MISMATCH')
  const release = currentRelease()
  input.onProgress?.('OPENING_CASE')
  const opened = await openFlexLife(input.snapshot)
  input.onProgress?.('FILLING_CLIENT')
  const client = opened.existing ? readClient(opened.doc, input.snapshot) : await fillClient(opened.doc, input.snapshot)
  if (!solvedClientMatches(input.snapshot, client)) fail('FORESIGHT_READBACK_CLIENT_MISMATCH')
  // FlexLife will not calculate a new solved illustration while its strategy
  // allocation is still 0%. Prime the required 100% allocation first.
  input.onProgress?.('CONFIGURING_PRODUCT')
  const primedAllocations = await fillAllocation(
    await navigate('/NWI/IUL2025/InterestRates.aspx', MENU_IDS.interestRates),
  )
  input.onProgress?.('CALCULATING')
  const ledgerDoc = await navigate('/NWI/IUL2025/ledger.aspx', MENU_IDS.ledger)
  const ledger = await fillSolvedLedger(ledgerDoc, input.snapshot)
  if (!ledger || hasCarrierCalculationError(ledgerDoc) || !solvedLedgerMatches(input.snapshot, ledger)) {
    fail(hasCarrierCalculationError(ledgerDoc) ? 'FORESIGHT_CALCULATION_UNAVAILABLE' : 'FORESIGHT_SOLVE_READBACK_MISMATCH')
  }
  input.onProgress?.('READING_QUICK_REVIEW')
  const quickReview = await readQuickViewForCase(ledger)
  // Two different things used to fail here as one, and conflating them cost a
  // whole generation.
  //
  // A Quick View that *contradicts* the ledger is the carrier disagreeing with
  // itself about the case it just calculated. Nothing may be issued on that.
  //
  // A Quick View that could not be *read* is only a second opinion that did not
  // arrive. The ledger already read back clean, and the official PDF — the
  // document that is actually authoritative — is still ahead. Which columns
  // Quick View renders depends on how the case was solved: a solve driven by
  // face amount need not print a target premium at all, and the summary reader
  // requires one. Refusing that case threw away the PDF, the confirmed
  // amounts, and the illustration itself for the sake of a projection that
  // enriches the client document rather than verifying anything.
  // Uma terceira coisa, que também já custou uma geração inteira: o Quick View
  // foi lido e discorda do ledger que a seguradora acabou de calcular.
  //
  // Isso desqualifica o Quick View, não a ilustração. Quem verifica são o
  // ledger — já conferido contra o pedido aprovado — e o PDF oficial, que é o
  // documento autoritativo. O Quick View entra para enriquecer o documento do
  // cliente com uma projeção; uma tela secundária discordante é motivo para
  // descartar a projeção e dizer por quê, não para destruir um PDF válido.
  //
  // Os dois pares comparados ficam registrados, porque sem eles uma
  // contradição é indiagnosticável e a próxima pessoa repete esta investigação.
  const quickViewOutcome: QuickViewReading =
    'review' in quickReview && !quickReviewMatchesLedger(quickReview.review, ledger)
      ? {
          unavailable: {
            reason: 'CONTRADICTS_LEDGER',
            summaryLabels: [],
            projectionLabels: [],
            comparison: {
              quickViewFaceAmount: quickReview.review.summary.initialFaceAmount,
              ledgerFaceAmount: ledger.faceAmount,
              quickViewModalPremium: quickReview.review.summary.modalPremium,
              ledgerMonthlyPremium: ledger.monthlyPremium,
            },
          },
        }
      : quickReview
  const ridersDoc = await navigate('/NWI/IUL2025/product.aspx', MENU_IDS.riders)
  const riders = verifyRiders(ridersDoc)
  const allocations = primedAllocations ?? readAllocation(
    await navigate('/NWI/IUL2025/InterestRates.aspx', MENU_IDS.interestRates),
  )
  const reportsDoc = await navigate('/NWI/ProductWorkflow/reportselection.aspx', MENU_IDS.reports)
  const reports = verifyReports(reportsDoc)
  if (JSON.stringify(allocations) !== JSON.stringify(input.snapshot.allocations) ||
    JSON.stringify(riders) !== JSON.stringify(input.snapshot.riders) ||
    JSON.stringify(reports) !== JSON.stringify(input.snapshot.reports)) {
    fail('FORESIGHT_READBACK_MISMATCH')
  }
  input.onProgress?.('VERIFYING_VALUES')
  if (!opened.existing) {
    input.onProgress?.('SAVING_CASE')
    await saveCase(input.snapshot.carrierCaseName)
  }
  input.onProgress?.('GENERATING_PDF')
  const document = await captureReportInMainWorld()
  const pdf = decodePdf(document)
  const receipt: ForesightSolvedExecutionReceipt = {
    inputHash: independentHash,
    caseFingerprint: await deterministicCaseFingerprint(input.snapshot),
    carrierCaseName: input.snapshot.carrierCaseName,
    productCode: '956',
    solveBasis: input.snapshot.solve.basis,
    faceAmount: ledger.faceAmount,
    monthlyPremium: ledger.monthlyPremium,
    annualPremium: ledger.annualPremium,
    // Omitted rather than set undefined: the receipt validator compares the key
    // set exactly, and a key holding undefined is still a key. Exactly one of
    // the two is written — the projection, or the reason there is none.
    ...('review' in quickViewOutcome
      ? { quickReview: quickViewOutcome.review }
      : { quickReviewUnavailable: quickViewOutcome.unavailable }),
    release,
    reportCode: 'NAIC_ILLUSTRATION',
    documentSha256: await sha256Hex(pdf),
    documentBytes: pdf.byteLength,
    saved: true,
  }
  return { receipt, document }
}

export async function executeForesightIllustration(input: {
  inputHash: string
  snapshot: ForesightIllustrationSnapshot
  onProgress?: ProgressReporter
}): Promise<{ receipt: AnyForesightExecutionReceipt; document: ForesightExecutionDocument }> {
  if (input.snapshot.schemaVersion === 2) return executeForesightSolvedIllustration({
    inputHash: input.inputHash,
    snapshot: input.snapshot,
    onProgress: input.onProgress,
  })
  return executeForesightIllustrationV1({ inputHash: input.inputHash, snapshot: input.snapshot, onProgress: input.onProgress })
}
