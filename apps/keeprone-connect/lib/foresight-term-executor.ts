import {
  classifyForesightLocation,
  parseForesightRelease,
} from './foresight-contract'
import {
  sha256ForesightTermSnapshot,
  type ForesightTermIllustrationSnapshotV1,
} from './foresight-term-contract'
import { ForesightExecutionError } from './foresight-executor'
import { carrierAmountEquals, foresightClientBirthDate } from './foresight-target'
import type {
  ForesightExecutionDocument,
  ForesightTermExecutionReceipt,
} from './foresight-messages'
import type { ForesightProgressPhase } from './foresight-progress'
import {
  FORESIGHT_TERM_OPTIONAL_REPORT_SELECTOR,
  isForesightTermNaicReportGroup,
} from './foresight-term-reports'

const MAIN_FRAME_ID = 'ctl00_mobilityPH_iframeMain'
const MODAL_FRAME_ID = 'ctl00_mobilityPH_modalDialog__Iframe'
const MAIN_CHANNEL = 'FYNTRA_FORESIGHT_CONNECTOR_V1'
const NEW_ILLUSTRATION_ID = 'ctl00_mobilityPH_verticalMenu_ActivitiesNewIllustration_0'
const TERM_CLIENT_MENU_ID = 'ctl00_mobilityPH_verticalMenu_Client_0'
const MODULE_LANDING_PATH = '/NWI/ProductWorkflow/ModuleLandingPage.aspx'
const SAVE_AS_ID = 'ctl00_mobilityPH_ucInfoContainer_lnkSaveAs'
const SAVE_NAME_ID = 'ctl00_mobilityPH_panelContent_txtItemName'
const SAVE_FOLDER_ID = 'ctl00_mobilityPH_panelContent_cboFolder'
const SAVE_CONFIRM_ID = 'ctl00_mobilityPH_panelContent_cmdSave'
const REPORT_MENU_ID = 'ctl00_mobilityPH_verticalMenu_Reportselection_2'
export const FORESIGHT_TERM_FUNDING_MENU_ID = 'ctl00_mobilityPH_verticalMenu_Ledger_0'

const PRODUCT_SELECTION = {
  jurisdiction: 'ctl00_mobilityPH_WebpanelGeneral_cboJurisdiction',
  productType: 'ctl00_mobilityPH_WebpanelGeneral_cboProductType',
  salesConcept: 'ctl00_mobilityPH_WebpanelGeneral_cboSalesConcept',
} as const

const TERM_FIELDS = {
  client: {
    jurisdiction: 'ctl00_mobilityPH_panelIllustration_cboJurisdiction',
    firstName: 'ctl00_mobilityPH_panelInsured_ucInsured_txtFirstName',
    lastName: 'ctl00_mobilityPH_panelInsured_ucInsured_txtLastName',
    gender: 'ctl00_mobilityPH_panelInsured_ucInsured_cboGender',
    birthDate: 'ctl00_mobilityPH_panelInsured_ucInsured_txtBirthDate',
    riskClass: 'ctl00_mobilityPH_panelInsured_ucRisk_cboRiskClass',
    tableRating: 'ctl00_mobilityPH_panelInsured_ucRisk_cboTableRating',
    flatExtra: 'ctl00_mobilityPH_panelInsured_ucRisk_txtFlatExtra',
    ownerType: 'ctl00_mobilityPH_panelOwner_ucOwner_cboOwnerType',
  },
  funding: {
    designType: 'ctl00_mobilityPH_panelDBO_ucDeathBenefit_cboDesignType',
    faceAmount: 'ctl00_mobilityPH_panelDBO_ucDeathBenefit_txtInitialFaceAmount',
    premiumMode: 'ctl00_mobilityPH_panelDBO_ucDeathBenefit_cboPremiumMode',
    termDuration: 'ctl00_mobilityPH_panelTermProduct_ucTermProduct_cboTermProduct',
  },
} as const

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}

function fail(code: string): never { throw new ForesightExecutionError(code) }

async function waitFor<T>(read: () => T | null | undefined | false, code: string, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = read()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return fail(code)
}

function iframe(id: string): HTMLIFrameElement {
  const value = document.getElementById(id)
  return value instanceof HTMLIFrameElement ? value : fail('FORESIGHT_SCHEMA_MISMATCH')
}

function frameDocument(id: string): Document | null {
  try { return iframe(id).contentDocument?.readyState === 'complete' ? iframe(id).contentDocument : null } catch { return null }
}

function framePath(id: string): string | null {
  try { return iframe(id).contentWindow?.location.pathname ?? null } catch { return null }
}

async function waitForFramePath(predicate: (path: string) => boolean, code = 'FORESIGHT_NAVIGATION_TIMEOUT'): Promise<Document> {
  return waitFor(() => {
    const path = framePath(MAIN_FRAME_ID)
    return path && predicate(path) ? frameDocument(MAIN_FRAME_ID) : null
  }, code)
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

function selectedText(element: HTMLSelectElement): string { return element.selectedOptions[0]?.text.trim() ?? '' }

function setSelectText(doc: Document, id: string, text: string): void {
  const element = select(doc, id)
  const option = [...element.options].find((candidate) => candidate.text.trim() === text)
  if (!option) fail('FORESIGHT_SCHEMA_MISMATCH')
  element.value = option.value
  emitChange(element)
  if (selectedText(element) !== text) fail('FORESIGHT_WRITE_MISMATCH')
}

function optionValue(doc: Document, id: string, text: string): string {
  const option = [...select(doc, id).options].find((candidate) => candidate.text.trim() === text)
  return option?.value ?? fail('FORESIGHT_SCHEMA_MISMATCH')
}

async function applyInMainWorld(
  type: 'APPLY_TERM_CLIENT' | 'APPLY_TERM_FUNDING' | 'APPLY_TERM_REPORTS',
  values: Record<string, string | number>,
): Promise<void> {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`
  const correlationId = crypto.randomUUID()
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => { window.removeEventListener('message', onMessage); reject(new ForesightExecutionError('FORESIGHT_MAIN_TIMEOUT')) }, 15_000)
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== location.origin || !event.data || typeof event.data !== 'object' ||
        event.data.channel !== MAIN_CHANNEL || !event.data.payload || typeof event.data.payload !== 'object') return
      const payload = event.data.payload as Record<string, unknown>
      if (payload.token !== token || payload.correlationId !== correlationId ||
        (payload.type !== 'FORESIGHT_MAIN_DONE' && payload.type !== 'FORESIGHT_MAIN_FAILED')) return
      window.clearTimeout(timer); window.removeEventListener('message', onMessage)
      if (payload.type === 'FORESIGHT_MAIN_DONE') resolve()
      else reject(new ForesightExecutionError(typeof payload.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(payload.code) ? payload.code : 'FORESIGHT_MAIN_FAILED'))
    }
    window.addEventListener('message', onMessage)
    window.postMessage({ channel: MAIN_CHANNEL, payload: { type, token, correlationId, values } }, location.origin)
  })
}

async function captureReport(): Promise<ForesightExecutionDocument> {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`
  const correlationId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { window.removeEventListener('message', onMessage); reject(new ForesightExecutionError('FORESIGHT_REPORT_TIMEOUT')) }, 125_000)
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== location.origin || !event.data || typeof event.data !== 'object' ||
        event.data.channel !== MAIN_CHANNEL || !event.data.payload || typeof event.data.payload !== 'object') return
      const payload = event.data.payload as Record<string, unknown>
      if (payload.token !== token || payload.correlationId !== correlationId ||
        (payload.type !== 'FORESIGHT_MAIN_REPORT' && payload.type !== 'FORESIGHT_MAIN_FAILED')) return
      window.clearTimeout(timer); window.removeEventListener('message', onMessage)
      if (payload.type === 'FORESIGHT_MAIN_FAILED' || payload.contentType !== 'application/pdf' || typeof payload.pdfBase64 !== 'string' ||
        payload.pdfBase64.length < 8 || payload.pdfBase64.length > 35_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.pdfBase64)) {
        reject(new ForesightExecutionError(payload.type === 'FORESIGHT_MAIN_FAILED' && typeof payload.code === 'string' ? payload.code : 'FORESIGHT_REPORT_RESPONSE_INVALID'))
      } else resolve({ contentType: 'application/pdf', pdfBase64: payload.pdfBase64 })
    }
    window.addEventListener('message', onMessage)
    window.postMessage({ channel: MAIN_CHANNEL, payload: { type: 'CAPTURE_REPORT', token, correlationId, values: {} } }, location.origin)
  })
}

function decodePdf(document: ForesightExecutionDocument): Uint8Array {
  let binary: string
  try { binary = atob(document.pdfBase64) } catch { return fail('FORESIGHT_REPORT_RESPONSE_INVALID') }
  if (binary.length < 5 || binary.length > 25 * 1024 * 1024 || !binary.startsWith('%PDF-')) fail('FORESIGHT_REPORT_RESPONSE_INVALID')
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer))
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function caseFingerprint(snapshot: ForesightTermIllustrationSnapshotV1): Promise<string> {
  return `case_${await sha256ForesightTermSnapshot(snapshot)}`
}

function currentRelease(): string {
  const release = parseForesightRelease({ visibleText: document.body?.innerText ?? '', scriptUrls: [...document.scripts].map((script) => script.src).filter(Boolean) })
  return release ?? fail('FORESIGHT_RELEASE_UNAPPROVED')
}

export function buildForesightTermClientTarget(snapshot: ForesightTermIllustrationSnapshotV1) {
  return {
    firstName: snapshot.insured.firstName,
    lastName: snapshot.insured.lastName,
    birthDate: foresightClientBirthDate(snapshot.insured.dateOfBirth),
  }
}

async function openTerm(snapshot: ForesightTermIllustrationSnapshotV1): Promise<{ doc: Document; existing: boolean }> {
  // After an interrupted Term run, Foresight can restore its in-progress case
  // at ModuleLandingPage rather than the case list. Resume only when the
  // active product is the requested Term product; the existing/readback path
  // performs no writes, so a mismatched open case cannot be overwritten.
  const landing = await waitFor(() => {
    const path = framePath(MAIN_FRAME_ID)
    if (path === '/NWI/Main/StartPage.aspx') return 'START' as const
    if (path === MODULE_LANDING_PATH &&
      document.getElementById(TERM_CLIENT_MENU_ID) instanceof HTMLElement &&
      document.body?.innerText.includes(snapshot.product.carrierName)) return 'RESUME' as const
    return null
  }, 'FORESIGHT_NAVIGATION_TIMEOUT')
  if (landing === 'RESUME') {
    click(document, TERM_CLIENT_MENU_ID)
    return {
      doc: await waitForFramePath((path) => /\/NWI\/.*\/client\.aspx$/i.test(path)),
      existing: true,
    }
  }
  const start = await waitForFramePath((path) => path === '/NWI/Main/StartPage.aspx')
  const existing = [...start.querySelectorAll<HTMLAnchorElement>('a')].filter((link) => link.textContent?.trim() === snapshot.carrierCaseName)
  if (existing.length > 1) fail('FORESIGHT_CASE_AMBIGUOUS')
  if (existing.length === 1) {
    const link = existing[0]!
    if (!link.href.startsWith('javascript:__doPostBack(') || !link.getAttribute('onclick')?.includes(`'${snapshot.carrierCaseName}'`)) fail('FORESIGHT_CASE_LINK_INVALID')
    link.click()
    return { doc: await waitForFramePath((path) => /\/NWI\/.*\/client\.aspx$/i.test(path)), existing: true }
  }
  click(document, NEW_ILLUSTRATION_ID)
  const modal = await waitFor(() => framePath(MODAL_FRAME_ID) === '/NWI/Main/ProductSelectionDialog.aspx' ? frameDocument(MODAL_FRAME_ID) : null, 'FORESIGHT_NAVIGATION_TIMEOUT')
  setSelectText(modal, PRODUCT_SELECTION.jurisdiction, STATE_NAMES[snapshot.insured.issueState] ?? fail('FORESIGHT_STATE_UNSUPPORTED'))
  setSelectText(modal, PRODUCT_SELECTION.productType, 'Any')
  setSelectText(modal, PRODUCT_SELECTION.salesConcept, 'Basic Illustration')
  const productId = snapshot.product.carrierName === 'LSW Term'
    ? 'ctl00_mobilityPH_WebpanelProduct_grdProducts_ctl11_lnkProduct'
    : 'ctl00_mobilityPH_WebpanelProduct_grdProducts_ctl12_lnkProduct'
  const product = modal.getElementById(productId)
  if (product?.tagName !== 'A' || product.textContent?.trim() !== snapshot.product.carrierName) fail('FORESIGHT_PRODUCT_UNAVAILABLE')
  product.click()
  return { doc: await waitForFramePath((path) => /\/NWI\/.*\/client\.aspx$/i.test(path)), existing: false }
}

function readClient(doc: Document, snapshot: ForesightTermIllustrationSnapshotV1) {
  const fields = TERM_FIELDS.client
  const rateText = selectedText(select(doc, fields.riskClass))
  return {
    firstName: input(doc, fields.firstName).value,
    lastName: input(doc, fields.lastName).value,
    dateOfBirth: input(doc, fields.birthDate).value,
    issueState: selectedText(select(doc, fields.jurisdiction)) === STATE_NAMES[snapshot.insured.issueState] ? snapshot.insured.issueState : 'MISMATCH',
    gender: selectedText(select(doc, fields.gender)),
    rateClass: rateText === 'Standard Non-Tobacco' ? 'Standard_NT' : rateText === 'Standard Tobacco' ? 'Standard_Tobacco' : 'MISMATCH',
  }
}

async function fillClient(doc: Document, snapshot: ForesightTermIllustrationSnapshotV1) {
  const fields = TERM_FIELDS.client
  const target = buildForesightTermClientTarget(snapshot)
  await applyInMainWorld('APPLY_TERM_CLIENT', {
    jurisdiction: optionValue(doc, fields.jurisdiction, STATE_NAMES[snapshot.insured.issueState]!),
    firstName: target.firstName, lastName: target.lastName,
    gender: optionValue(doc, fields.gender, snapshot.underwriting.gender), birthDate: target.birthDate,
    riskClass: optionValue(doc, fields.riskClass, snapshot.underwriting.rateClass === 'Standard_NT' ? 'Standard Non-Tobacco' : 'Standard Tobacco'),
  })
  doc = await waitForFramePath((path) => /\/NWI\/.*\/client\.aspx$/i.test(path))
  await waitFor(() => input(doc, fields.firstName).value === target.firstName && input(doc, fields.lastName).value === target.lastName && input(doc, fields.birthDate).value === target.birthDate ? true : null, 'FORESIGHT_CLIENT_READBACK_TIMEOUT')
  return readClient(doc, snapshot)
}

async function fundingDocument(): Promise<Document> {
  click(document, FORESIGHT_TERM_FUNDING_MENU_ID)
  return waitFor(() => {
    const doc = frameDocument(MAIN_FRAME_ID)
    return doc?.getElementById(TERM_FIELDS.funding.designType) ? doc : null
  }, 'FORESIGHT_TERM_FUNDING_NAVIGATION_TIMEOUT')
}

function readFunding(doc: Document) {
  return {
    designType: selectedText(select(doc, TERM_FIELDS.funding.designType)),
    faceAmount: input(doc, TERM_FIELDS.funding.faceAmount).value,
    premiumMode: selectedText(select(doc, TERM_FIELDS.funding.premiumMode)),
    termDuration: selectedText(select(doc, TERM_FIELDS.funding.termDuration)),
  }
}

type ForesightTermClientReadback = ReturnType<typeof readClient>
type ForesightTermFundingReadback = ReturnType<typeof readFunding>
const TERM_DURATIONS = new Set<ForesightTermIllustrationSnapshotV1['termDuration']>([
  '10-G', '15-G', '20-G', '30-G', 'ART',
])

function isTermDuration(value: string): value is ForesightTermIllustrationSnapshotV1['termDuration'] {
  return TERM_DURATIONS.has(value as ForesightTermIllustrationSnapshotV1['termDuration'])
}

export function resolveForesightTermDuration(
  snapshot: ForesightTermIllustrationSnapshotV1,
  observed: string,
): {
  requestedTermDuration: ForesightTermIllustrationSnapshotV1['termDuration']
  confirmedTermDuration: ForesightTermIllustrationSnapshotV1['termDuration']
} {
  if (!isTermDuration(observed)) fail('FORESIGHT_TERM_DURATION_READBACK_MISMATCH')
  return {
    requestedTermDuration: snapshot.termDuration,
    confirmedTermDuration: observed,
  }
}

export function foresightTermReadbackError(
  snapshot: ForesightTermIllustrationSnapshotV1,
  client: ForesightTermClientReadback,
  funding: ForesightTermFundingReadback,
): string | null {
  if (client.firstName !== snapshot.insured.firstName ||
    client.lastName !== snapshot.insured.lastName ||
    client.dateOfBirth !== foresightClientBirthDate(snapshot.insured.dateOfBirth) ||
    client.issueState !== snapshot.insured.issueState ||
    client.gender !== snapshot.underwriting.gender ||
    client.rateClass !== snapshot.underwriting.rateClass) {
    return 'FORESIGHT_TERM_CLIENT_READBACK_MISMATCH'
  }
  if (funding.designType !== 'Specify Face Amount' || funding.premiumMode !== 'Monthly') {
    return 'FORESIGHT_TERM_FUNDING_READBACK_MISMATCH'
  }
  if (!carrierAmountEquals(funding.faceAmount, snapshot.faceAmount)) {
    return 'FORESIGHT_TERM_FACE_AMOUNT_READBACK_MISMATCH'
  }
  if (!isTermDuration(funding.termDuration)) {
    return 'FORESIGHT_TERM_DURATION_READBACK_MISMATCH'
  }
  return null
}

async function fillFunding(doc: Document, snapshot: ForesightTermIllustrationSnapshotV1) {
  await applyInMainWorld('APPLY_TERM_FUNDING', {
    designType: optionValue(doc, TERM_FIELDS.funding.designType, 'Specify Face Amount'),
    faceAmount: snapshot.faceAmount,
    premiumMode: optionValue(doc, TERM_FIELDS.funding.premiumMode, 'Monthly'),
    termDuration: optionValue(doc, TERM_FIELDS.funding.termDuration, snapshot.termDuration),
  })
  doc = await waitFor(() => {
    const current = frameDocument(MAIN_FRAME_ID)
    return current?.getElementById(TERM_FIELDS.funding.designType) ? current : null
  }, 'FORESIGHT_TERM_FUNDING_NAVIGATION_TIMEOUT')
  await waitFor(() => carrierAmountEquals(
    input(doc, TERM_FIELDS.funding.faceAmount).value,
    snapshot.faceAmount,
  ) ? true : null, 'FORESIGHT_TERM_FACE_AMOUNT_WRITE_MISMATCH')
  return readFunding(doc)
}

async function reportsDocument(): Promise<Document> {
  click(document, REPORT_MENU_ID)
  return waitFor(() => {
    const doc = frameDocument(MAIN_FRAME_ID)
    return doc?.body?.innerText.includes('NAIC Illustration') ? doc : null
  }, 'FORESIGHT_REPORT_SELECTION_MISMATCH')
}

async function verifyReports(duration: string): Promise<void> {
  await applyInMainWorld('APPLY_TERM_REPORTS', { duration })
  // Report selection is an ASP.NET postback. The desired checkbox can be
  // visible while a carrier response still restores the previous selection;
  // keep reacquiring the frame until the exact final state is observable.
  await waitFor(() => {
    const doc = frameDocument(MAIN_FRAME_ID)
    if (!doc) return null
    const groups = [...doc.querySelectorAll<HTMLInputElement>('input[type="checkbox"][id$="_chkGroup"]')]
      .filter((checkbox) => checkbox.checked)
    if (groups.length !== 1 || !isForesightTermNaicReportGroup(groups[0]!, duration)) return null
    const extras = [...doc.querySelectorAll<HTMLInputElement>(
      FORESIGHT_TERM_OPTIONAL_REPORT_SELECTOR,
    )].filter((checkbox) => checkbox.checked)
    return extras.length === 0 ? true : null
  }, 'FORESIGHT_REPORT_SELECTION_MISMATCH')
}

async function saveCase(caseName: string): Promise<void> {
  click(document, SAVE_AS_ID)
  const modal = await waitFor(() => framePath(MODAL_FRAME_ID) === '/NWI/Main/SaveDialog.aspx' ? frameDocument(MODAL_FRAME_ID) : null, 'FORESIGHT_NAVIGATION_TIMEOUT')
  const name = input(modal, SAVE_NAME_ID); name.value = caseName; emitChange(name)
  setSelectText(modal, SAVE_FOLDER_ID, 'My Cases'); click(modal, SAVE_CONFIRM_ID)
  const outcome = await waitFor(() => {
    const doc = frameDocument(MODAL_FRAME_ID)
    if (!doc || !iframe(MODAL_FRAME_ID).getAttribute('src')) return 'SAVED'
    if (doc.body?.innerText.includes('Duplicate Name')) return 'DUPLICATE'
    return null
  }, 'FORESIGHT_SAVE_TIMEOUT')
  if (outcome === 'DUPLICATE') fail('FORESIGHT_DUPLICATE_CASE')
  await waitFor(() => document.body?.innerText.includes(caseName), 'FORESIGHT_SAVE_READBACK_FAILED')
}

export async function executeForesightTermIllustration(input: {
  inputHash: string
  snapshot: ForesightTermIllustrationSnapshotV1
  onProgress?: (phase: ForesightProgressPhase) => void
}): Promise<{ receipt: ForesightTermExecutionReceipt; document: ForesightExecutionDocument }> {
  if (classifyForesightLocation(location.href) !== 'FORESIGHT' || location.pathname !== '/NWI/Main/Layout.aspx') fail('FORESIGHT_LOCATION_UNEXPECTED')
  const independentHash = await sha256ForesightTermSnapshot(input.snapshot)
  if (independentHash !== input.inputHash) fail('FORESIGHT_INPUT_HASH_MISMATCH')
  const release = currentRelease()
  input.onProgress?.('OPENING_CASE')
  const opened = await openTerm(input.snapshot)
  input.onProgress?.('FILLING_CLIENT')
  const client = opened.existing ? readClient(opened.doc, input.snapshot) : await fillClient(opened.doc, input.snapshot)
  input.onProgress?.('CONFIGURING_PRODUCT')
  const fundingDoc = await fundingDocument()
  const funding = opened.existing ? readFunding(fundingDoc) : await fillFunding(fundingDoc, input.snapshot)
  const readbackError = foresightTermReadbackError(input.snapshot, client, funding)
  if (readbackError) fail(readbackError)
  const termDuration = resolveForesightTermDuration(input.snapshot, funding.termDuration)
  input.onProgress?.('VERIFYING_VALUES')
  await reportsDocument()
  await verifyReports(termDuration.confirmedTermDuration)
  if (!opened.existing) {
    input.onProgress?.('SAVING_CASE')
    await saveCase(input.snapshot.carrierCaseName)
  }
  input.onProgress?.('GENERATING_PDF')
  const document = await captureReport()
  const pdf = decodePdf(document)
  return {
    receipt: {
      inputHash: independentHash,
      caseFingerprint: await caseFingerprint(input.snapshot),
      carrierCaseName: input.snapshot.carrierCaseName,
      carrierProduct: input.snapshot.product.carrierName,
      requestedTermDuration: termDuration.requestedTermDuration,
      confirmedTermDuration: termDuration.confirmedTermDuration,
      release,
      reportCode: 'NAIC_ILLUSTRATION',
      documentSha256: await sha256Hex(pdf),
      documentBytes: pdf.byteLength,
      saved: true,
    },
    document,
  }
}
