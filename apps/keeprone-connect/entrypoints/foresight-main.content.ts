import { FORESIGHT_FLEXLIFE_FIELDS, foresightSolveValue } from '../lib/foresight-target'
import { isForesightPdf, parseForesightReportUrl } from '../lib/foresight-report'
import {
  applyForesightAllocationPreference,
  waitForForesightAsyncWorkerIdle,
  writeForesightControlValueWhenReady,
} from '../lib/foresight-control-value'
import {
  FORESIGHT_TERM_OPTIONAL_REPORT_SELECTOR,
  isForesightTermNaicReportGroup,
} from '../lib/foresight-term-reports'

const CHANNEL = 'FYNTRA_FORESIGHT_CONNECTOR_V1'
const MAIN_FRAME_ID = 'ctl00_mobilityPH_iframeMain'
type CarrierDeferred = {
  done(callback: () => void): CarrierDeferred
  fail(callback: () => void): CarrierDeferred
}
type CarrierWindow = Window & {
  $find?: (id: string) => unknown
  $ITAjax?: {
    sendRequest(path: string, parameters: unknown[]): CarrierDeferred
  }
  $ITCommon?: { sessionTokenId(): string }
  $ITAsyncWorker?: { _isIdle?: boolean }
  __doPostBack?: (target: string, argument: string) => void
}

type MainRequest = {
  type: 'APPLY_CLIENT' | 'APPLY_LEDGER' | 'APPLY_LEDGER_SOLVE' | 'APPLY_ALLOCATION' |
    'APPLY_TERM_CLIENT' | 'APPLY_TERM_FUNDING' | 'APPLY_TERM_REPORTS' | 'CAPTURE_REPORT'
  token: string
  correlationId: string
  values: Record<string, string | number>
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function request(value: unknown): MainRequest | null {
  if (!object(value) || ![
    'APPLY_CLIENT', 'APPLY_LEDGER', 'APPLY_LEDGER_SOLVE', 'APPLY_ALLOCATION',
    'APPLY_TERM_CLIENT', 'APPLY_TERM_FUNDING', 'APPLY_TERM_REPORTS', 'CAPTURE_REPORT',
  ].includes(String(value.type)) ||
    typeof value.token !== 'string' || value.token.length < 32 || value.token.length > 128 ||
    typeof value.correlationId !== 'string' || value.correlationId.length < 16 || value.correlationId.length > 128 ||
    !object(value.values) || Object.keys(value.values).length > 20 ||
    !Object.values(value.values).every((entry) =>
      (typeof entry === 'string' && entry.length <= 100) ||
      (typeof entry === 'number' && Number.isFinite(entry)))) return null
  return value as MainRequest
}

export default defineContentScript({
  matches: ['https://www.nationallife.com/NWI/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    if (window.top !== window || location.pathname !== '/NWI/Main/Layout.aspx') return
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    const carrier = () => {
      const iframe = document.getElementById(MAIN_FRAME_ID)
      if (!(iframe instanceof HTMLIFrameElement) || !iframe.contentDocument || !iframe.contentWindow) {
        throw new Error('FORESIGHT_SCHEMA_MISMATCH')
      }
      return {
        doc: iframe.contentDocument,
        win: iframe.contentWindow as CarrierWindow,
      }
    }
    const element = <T extends HTMLInputElement | HTMLSelectElement>(doc: Document, id: string): T => {
      const value = doc.getElementById(id)
      if (value?.tagName !== 'INPUT' && value?.tagName !== 'SELECT') {
        throw new Error('FORESIGHT_SCHEMA_MISMATCH')
      }
      return value as T
    }
    const setInput = (doc: Document, id: string, value: string) => {
      const input = element<HTMLInputElement>(doc, id)
      const control = (input as HTMLInputElement & { control?: { set_Value(value: string): void } }).control
      if (control?.set_Value) control.set_Value(value)
      else input.value = value
      return input
    }
    const setSelect = (doc: Document, id: string, value: string) => {
      const select = element<HTMLSelectElement>(doc, id)
      if (![...select.options].some((option) => option.value === value)) {
        throw new Error('FORESIGHT_SCHEMA_MISMATCH')
      }
      select.value = value
    }
    const invoke = (win: CarrierWindow, id: string, method: string, ...args: unknown[]) => {
      const value = win.$find?.(id)
      if (!object(value) || typeof value[method] !== 'function') {
        throw new Error('FORESIGHT_SCHEMA_MISMATCH')
      }
      ;(value[method] as (...values: unknown[]) => unknown).apply(value, args)
    }
    const waitForCarrierIdle = async (
      timeoutCode = 'FORESIGHT_TERM_FUNDING_TIMEOUT',
      minimumSettleMs = 0,
    ) => {
      // A Foresight component method can return just before its ASP.NET work
      // is registered in $ITAsyncWorker. Preserve the known settling window,
      // then require the carrier's queue to become idle before the next write.
      if (minimumSettleMs > 0) await delay(minimumSettleMs)
      const idle = await waitForForesightAsyncWorkerIdle({
        read: () => carrier().win.$ITAsyncWorker,
        wait: () => delay(100),
      })
      if (!idle) throw new Error(timeoutCode)
    }
    const writeScheduleValue = async (id: string, value: number) => {
      const written = await writeForesightControlValueWhenReady({
        read: () => element<HTMLInputElement>(carrier().doc, id),
        value,
        wait: () => delay(100),
      })
      if (!written) throw new Error('FORESIGHT_CONTROL_UNAVAILABLE')
    }
    const setWidgetNumber = (win: CarrierWindow, id: string, value: number) => {
      const widget = win.$find?.(id)
      if (!object(widget) || typeof widget.set_Value !== 'function') {
        throw new Error('FORESIGHT_SCHEMA_MISMATCH')
      }
      ;(widget.set_Value as (value: string) => void).call(widget, String(value))
      const raw = typeof widget.get_RawValue === 'function'
        ? (widget.get_RawValue as () => unknown).call(widget)
        : null
      const observed = Number(String(raw).replace(/[^0-9.-]/g, ''))
      if (!Number.isFinite(observed) || Math.abs(observed - value) > 0.005) {
        throw new Error('FORESIGHT_WRITE_MISMATCH')
      }
    }
    const applyClient = async (values: MainRequest['values']) => {
      let { doc, win } = carrier()
      setSelect(doc, FORESIGHT_FLEXLIFE_FIELDS.client.jurisdiction, String(values.jurisdiction))
      element<HTMLSelectElement>(doc, FORESIGHT_FLEXLIFE_FIELDS.client.jurisdiction)
        .dispatchEvent(new Event('change', { bubbles: true }))
      await delay(700)

      ;({ doc, win } = carrier())
      setInput(doc, FORESIGHT_FLEXLIFE_FIELDS.client.firstName, String(values.firstName))
      setInput(doc, FORESIGHT_FLEXLIFE_FIELDS.client.lastName, String(values.lastName))
      invoke(win, 'ctl00_mobilityPH_panelFirstInsured_ucInsured', 'updateName')
      await delay(500)
      setSelect(doc, FORESIGHT_FLEXLIFE_FIELDS.client.gender, String(values.gender))
      setInput(doc, FORESIGHT_FLEXLIFE_FIELDS.client.birthDate, String(values.birthDate))
      invoke(win, 'ctl00_mobilityPH_panelFirstInsured_ucInsured', 'updateInformation')
      await delay(800)

      ;({ doc, win } = carrier())
      setSelect(doc, FORESIGHT_FLEXLIFE_FIELDS.client.riskClass, String(values.riskClass))
      setSelect(doc, FORESIGHT_FLEXLIFE_FIELDS.client.tableRating, '0')
      setInput(doc, FORESIGHT_FLEXLIFE_FIELDS.client.flatExtra, '0')
      setSelect(doc, FORESIGHT_FLEXLIFE_FIELDS.client.pensionUnderwriting, '0')
      invoke(win, 'ctl00_mobilityPH_panelFirstInsured_ucRisk', 'updateInformation')
      await delay(600)
      setSelect(doc, FORESIGHT_FLEXLIFE_FIELDS.client.ownerType, '-7')
      invoke(win, 'ctl00_mobilityPH_panelOwner_ucOwner', 'updateOwnerType')
      await delay(600)
    }
    const applyLedger = async (values: MainRequest['values']) => {
      let { doc, win } = carrier()
      invoke(win, 'ctl00_mobilityPH_panelDBO_ucDeathBenefit_rdoDeathBenefitSolves', 'set_Value', 0)
      setSelect(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.deathBenefitType, '-4')
      setInput(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.deathBenefitAmount, String(values.faceAmount))
      invoke(win, 'ctl00_mobilityPH_panelDBO_ucDeathBenefit', 'updateDeathBenefitSchedule')
      await delay(900)

      ;({ doc, win } = carrier())
      setSelect(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.deathBenefitOption, String(values.deathBenefitOption))
      invoke(win, 'ctl00_mobilityPH_panelDBO_ucDeathBenefitOption', 'updateDeathBenefitOptionSchedule')
      await delay(900)

      ;({ doc, win } = carrier())
      setSelect(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.premiumMode, '7')
      invoke(win, 'ctl00_mobilityPH_panelPremium_ucPremium', 'updatePremiumMode')
      await delay(900)

      ;({ doc, win } = carrier())
      setSelect(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.premiumType, '-4')
      element<HTMLSelectElement>(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.premiumType)
        .dispatchEvent(new Event('change', { bubbles: true }))
      await delay(500)

      ;({ doc, win } = carrier())
      // Foresight owns a widget value as well as its displayed input. Writing
      // only the latter makes the page restore its previous/default premium
      // during updatePremiumSchedule.
      await writeScheduleValue(
        FORESIGHT_FLEXLIFE_FIELDS.ledger.premiumAmount,
        Number(values.premiumAmount),
      )
      await delay(200)

      ;({ doc, win } = carrier())
      invoke(win, 'ctl00_mobilityPH_panelPremium_ucPremium', 'updatePremiumSchedule')
      await delay(1_100)
    }
    const solveRadio = (doc: Document, marker: string, label: string) => {
      const expectedValue = foresightSolveValue(marker, label)
      if (!expectedValue) throw new Error('FORESIGHT_SCHEMA_MISMATCH')
      const radios = [...doc.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
        .filter((radio) => radio.id.includes(marker) || radio.name.includes(marker))
      const matches = radios.filter((radio) => radio.value === expectedValue)
      if (matches.length !== 1) throw new Error('FORESIGHT_SCHEMA_MISMATCH')
      const radio = matches[0]!
      if (!radio.checked) radio.click()
      if (!radio.checked) throw new Error('FORESIGHT_WRITE_MISMATCH')
    }
    const applySolvedLedger = async (values: MainRequest['values']) => {
      const basis = String(values.solveBasis)
      if (basis !== 'DEATH_BENEFIT' && basis !== 'PREMIUM') {
        throw new Error('FORESIGHT_SCHEMA_MISMATCH')
      }
      let { doc, win } = carrier()
      if (basis === 'PREMIUM') {
        solveRadio(doc, 'rdoDeathBenefitSolves', 'Based on Target Premium')
        await delay(900)
        ;({ doc, win } = carrier())
        solveRadio(doc, 'rdoPremiumSolves', 'None')
        await delay(500)
        ;({ doc, win } = carrier())
        setSelect(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.premiumMode, '7')
        invoke(win, 'ctl00_mobilityPH_panelPremium_ucPremium', 'updatePremiumMode')
        await delay(900)
        ;({ doc, win } = carrier())
        setSelect(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.premiumType, '-4')
        element<HTMLSelectElement>(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.premiumType)
          .dispatchEvent(new Event('change', { bubbles: true }))
        await delay(500)
        ;({ doc, win } = carrier())
        await writeScheduleValue(
          FORESIGHT_FLEXLIFE_FIELDS.ledger.premiumAmount,
          Number(values.premiumAmount),
        )
        await delay(200)
        ;({ doc, win } = carrier())
        invoke(win, 'ctl00_mobilityPH_panelPremium_ucPremium', 'updatePremiumSchedule')
        await delay(1_100)
      } else {
        solveRadio(doc, 'rdoDeathBenefitSolves', 'None')
        await delay(500)
        ;({ doc, win } = carrier())
        setSelect(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.deathBenefitType, '-4')
        await writeScheduleValue(
          FORESIGHT_FLEXLIFE_FIELDS.ledger.deathBenefitAmount,
          Number(values.faceAmount),
        )
        invoke(win, 'ctl00_mobilityPH_panelDBO_ucDeathBenefit', 'updateDeathBenefitSchedule')
        await delay(900)
        ;({ doc, win } = carrier())
        setSelect(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.premiumMode, '7')
        invoke(win, 'ctl00_mobilityPH_panelPremium_ucPremium', 'updatePremiumMode')
        await delay(900)
        ;({ doc, win } = carrier())
        solveRadio(doc, 'rdoPremiumSolves', 'Protection Focus')
        await delay(1_100)
      }
      ;({ doc, win } = carrier())
      setSelect(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.deathBenefitOption, String(values.deathBenefitOption))
      invoke(win, 'ctl00_mobilityPH_panelDBO_ucDeathBenefitOption', 'updateDeathBenefitOptionSchedule')
      await delay(900)
    }
    const applyAllocation = async () => {
      const { doc, win } = carrier()
      const preference = element<HTMLSelectElement>(
        doc,
        'ctl00_mobilityPH_panelInterestRates_cboPremiumAllocationPreference',
      )
      if (!win.$ITAjax?.sendRequest || !win.$ITCommon?.sessionTokenId || !win.__doPostBack ||
        !await applyForesightAllocationPreference({
          select: preference,
          preference: '24',
          sessionTokenId: () => win.$ITCommon!.sessionTokenId(),
          sendRequest: (path, parameters) => win.$ITAjax!.sendRequest(path, parameters),
          postBack: (target, argument) => win.__doPostBack!(target, argument),
        })) {
        throw new Error('FORESIGHT_SCHEMA_MISMATCH')
      }
      for (let attempt = 0; attempt < 25; attempt += 1) {
        await delay(200)
        try {
          const current = carrier().doc
          if (element<HTMLInputElement>(
            current,
            'ctl00_mobilityPH_panelInterestRates_txtStrategy1Allocation',
          ).value === '100' && element<HTMLInputElement>(
            current,
            'ctl00_mobilityPH_panelInterestRates_txtTotalAllocation',
          ).value === '100') return
        } catch {
          // The carrier replaces the iframe document during its postback.
        }
      }
      throw new Error('FORESIGHT_ALLOCATION_WRITE_MISMATCH')
    }
    const optionByText = (doc: Document, id: string, text: string) => {
      const select = element<HTMLSelectElement>(doc, id)
      const option = [...select.options].find((candidate) => candidate.text.trim() === text)
      if (!option) throw new Error('FORESIGHT_SCHEMA_MISMATCH')
      return option.value
    }
    const retryTermClientPostback = async (
      minimumSettleMs: number,
      mismatchCode: string,
      write: (doc: Document, win: CarrierWindow) => void,
      matches: (doc: Document) => boolean,
    ) => {
      let timedOut = false
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { doc, win } = carrier()
        write(doc, win)
        try {
          await waitForCarrierIdle('FORESIGHT_TERM_CLIENT_TIMEOUT', minimumSettleMs)
          if (matches(carrier().doc)) return
        } catch (error) {
          if (!(error instanceof Error) || error.message !== 'FORESIGHT_TERM_CLIENT_TIMEOUT') throw error
          timedOut = true
        }
      }
      throw new Error(timedOut ? 'FORESIGHT_TERM_CLIENT_TIMEOUT' : mismatchCode)
    }
    const applyTermClient = async (values: MainRequest['values']) => {
      const fields = {
        jurisdiction: 'ctl00_mobilityPH_panelIllustration_cboJurisdiction',
        firstName: 'ctl00_mobilityPH_panelInsured_ucInsured_txtFirstName',
        lastName: 'ctl00_mobilityPH_panelInsured_ucInsured_txtLastName',
        gender: 'ctl00_mobilityPH_panelInsured_ucInsured_cboGender',
        birthDate: 'ctl00_mobilityPH_panelInsured_ucInsured_txtBirthDate',
        riskClass: 'ctl00_mobilityPH_panelInsured_ucRisk_cboRiskClass',
        ownerType: 'ctl00_mobilityPH_panelOwner_ucOwner_cboOwnerType',
      }
      const writeName = (doc: Document, win: CarrierWindow) => {
        setInput(doc, fields.firstName, String(values.firstName))
        setInput(doc, fields.lastName, String(values.lastName))
        invoke(win, 'ctl00_mobilityPH_panelInsured_ucInsured', 'updateName')
      }
      const namesMatch = (doc: Document) =>
        element<HTMLInputElement>(doc, fields.firstName).value === String(values.firstName) &&
        element<HTMLInputElement>(doc, fields.lastName).value === String(values.lastName)
      const matchesCompleteTermClient = (doc: Document) => namesMatch(doc) &&
        element<HTMLSelectElement>(doc, fields.jurisdiction).value === String(values.jurisdiction) &&
        element<HTMLSelectElement>(doc, fields.gender).value === String(values.gender) &&
        element<HTMLInputElement>(doc, fields.birthDate).value === String(values.birthDate) &&
        element<HTMLSelectElement>(doc, fields.riskClass).value === String(values.riskClass) &&
        element<HTMLSelectElement>(doc, fields.ownerType).value ===
          optionByText(doc, fields.ownerType, 'Same as Insured')
      await retryTermClientPostback(700, 'FORESIGHT_TERM_CLIENT_JURISDICTION_WRITE_MISMATCH', (doc) => {
        setSelect(doc, fields.jurisdiction, String(values.jurisdiction))
        element<HTMLSelectElement>(doc, fields.jurisdiction).dispatchEvent(new Event('change', { bubbles: true }))
      }, (doc) => element<HTMLSelectElement>(doc, fields.jurisdiction).value === String(values.jurisdiction))
      await retryTermClientPostback(
        500, 'FORESIGHT_TERM_CLIENT_NAME_WRITE_MISMATCH', writeName, namesMatch,
      )
      await retryTermClientPostback(800, 'FORESIGHT_TERM_CLIENT_INFORMATION_WRITE_MISMATCH', (doc, win) => {
        setSelect(doc, fields.gender, String(values.gender))
        setInput(doc, fields.birthDate, String(values.birthDate))
        invoke(win, 'ctl00_mobilityPH_panelInsured_ucInsured', 'updateInformation')
      }, (doc) => element<HTMLSelectElement>(doc, fields.gender).value === String(values.gender) &&
        element<HTMLInputElement>(doc, fields.birthDate).value === String(values.birthDate))
      await retryTermClientPostback(600, 'FORESIGHT_TERM_CLIENT_RISK_WRITE_MISMATCH', (doc, win) => {
        setSelect(doc, fields.riskClass, String(values.riskClass))
        invoke(win, 'ctl00_mobilityPH_panelInsured_ucRisk', 'updateInformation')
      }, (doc) => element<HTMLSelectElement>(doc, fields.riskClass).value === String(values.riskClass))
      await retryTermClientPostback(600, 'FORESIGHT_TERM_CLIENT_OWNER_WRITE_MISMATCH', (doc, win) => {
        setSelect(doc, fields.ownerType, optionByText(doc, fields.ownerType, 'Same as Insured'))
        invoke(win, 'ctl00_mobilityPH_panelOwner_ucOwner', 'updateOwnerType')
      }, (doc) => element<HTMLSelectElement>(doc, fields.ownerType).value ===
        optionByText(doc, fields.ownerType, 'Same as Insured'))
      // Foresight's owner postback can restore the insured name from its case
      // defaults while leaving birth date, state and risk intact. Repair only
      // that observed loss, then require a cumulative readback before funding.
      if (!namesMatch(carrier().doc)) {
        await retryTermClientPostback(
          500, 'FORESIGHT_TERM_CLIENT_NAME_WRITE_MISMATCH', writeName, namesMatch,
        )
      }
      if (!matchesCompleteTermClient(carrier().doc)) {
        throw new Error('FORESIGHT_TERM_CLIENT_CUMULATIVE_WRITE_MISMATCH')
      }
    }
    const applyTermFunding = async (values: MainRequest['values']) => {
      let { doc, win } = carrier()
      const fields = {
        designType: 'ctl00_mobilityPH_panelDBO_ucDeathBenefit_cboDesignType',
        faceAmount: 'ctl00_mobilityPH_panelDBO_ucDeathBenefit_txtInitialFaceAmount',
        premiumMode: 'ctl00_mobilityPH_panelDBO_ucDeathBenefit_cboPremiumMode',
        termDuration: 'ctl00_mobilityPH_panelTermProduct_ucTermProduct_cboTermProduct',
      }
      setSelect(doc, fields.designType, String(values.designType))
      setWidgetNumber(win, fields.faceAmount, Number(values.faceAmount))
      invoke(win, 'ctl00_mobilityPH_panelDBO_ucDeathBenefit', 'updateDeathBenefit')
      await waitForCarrierIdle()
      ;({ doc, win } = carrier())
      setSelect(doc, fields.premiumMode, String(values.premiumMode))
      invoke(win, 'ctl00_mobilityPH_panelDBO_ucDeathBenefit', 'updatePremium')
      await waitForCarrierIdle()
      ;({ doc, win } = carrier())
      setSelect(doc, fields.termDuration, String(values.termDuration))
      invoke(win, 'ctl00_mobilityPH_panelTermProduct_ucTermProduct', 'updateTermProduct')
      await waitForCarrierIdle()
    }
    const applyTermReports = async (values: MainRequest['values']) => {
      const { doc } = carrier()
      const groups = [...doc.querySelectorAll<HTMLInputElement>('input[type="checkbox"][id$="_chkGroup"]')]
      const main = groups.find((checkbox) => isForesightTermNaicReportGroup(
        checkbox,
        String(values.duration),
      ))
      if (!main) throw new Error('FORESIGHT_REPORT_SELECTION_MISMATCH')
      for (const checkbox of groups) if (checkbox !== main && checkbox.checked) checkbox.click()
      if (!main.checked) main.click()
      for (const checkbox of doc.querySelectorAll<HTMLInputElement>(
        FORESIGHT_TERM_OPTIONAL_REPORT_SELECTOR,
      )) {
        if (checkbox.checked) checkbox.click()
      }
      await delay(500)
    }
    const base64 = (bytes: Uint8Array) => {
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 32_768) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768))
      }
      return btoa(binary)
    }
    const captureReport = async () => {
      const run = document.getElementById('ctl00_mobilityPH_ucInfoContainer_lnkRun')
      if (!(run instanceof HTMLAnchorElement)) throw new Error('FORESIGHT_SCHEMA_MISMATCH')
      const originalOpen = window.open
      let timer = 0
      try {
        const reportUrl = await new Promise<string>((resolve, reject) => {
          timer = window.setTimeout(() => reject(new Error('FORESIGHT_REPORT_TIMEOUT')), 120_000)
          window.open = ((url?: string | URL) => {
            const resolved = new URL(String(url ?? ''), location.href)
            window.clearTimeout(timer)
            window.open = originalOpen
            resolve(resolved.href)
            return { focus() {} } as Window
          }) as typeof window.open
          run.click()
        })
        const resolved = parseForesightReportUrl(reportUrl, location.origin)
        if (!resolved) throw new Error('FORESIGHT_REPORT_URL_INVALID')
        const response = await fetch(resolved.href, {
          credentials: 'include', cache: 'no-store', redirect: 'error',
        })
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (!response.ok || !isForesightPdf(response.headers.get('content-type'), bytes)) {
          throw new Error('FORESIGHT_REPORT_RESPONSE_INVALID')
        }
        return { contentType: 'application/pdf' as const, pdfBase64: base64(bytes) }
      } finally {
        window.clearTimeout(timer)
        window.open = originalOpen
      }
    }

    window.addEventListener('message', (event) => {
      if (event.source !== window || event.origin !== location.origin || !object(event.data) ||
        event.data.channel !== CHANNEL) return
      const value = request(event.data.payload)
      if (!value) return
      void (value.type === 'APPLY_CLIENT' ? applyClient(value.values)
        : value.type === 'APPLY_LEDGER' ? applyLedger(value.values)
          : value.type === 'APPLY_LEDGER_SOLVE' ? applySolvedLedger(value.values)
            : value.type === 'APPLY_ALLOCATION' ? applyAllocation()
              : value.type === 'APPLY_TERM_CLIENT' ? applyTermClient(value.values)
                : value.type === 'APPLY_TERM_FUNDING' ? applyTermFunding(value.values)
                  : value.type === 'APPLY_TERM_REPORTS' ? applyTermReports(value.values)
                    : captureReport()).then(
        (result) => window.postMessage({
          channel: CHANNEL,
          payload: result ? {
            type: 'FORESIGHT_MAIN_REPORT', token: value.token, correlationId: value.correlationId,
            ...result,
          } : { type: 'FORESIGHT_MAIN_DONE', token: value.token, correlationId: value.correlationId },
        }, location.origin),
        (error: unknown) => window.postMessage({
          channel: CHANNEL,
          payload: {
            type: 'FORESIGHT_MAIN_FAILED',
            token: value.token,
            correlationId: value.correlationId,
            code: error instanceof Error && /^[A-Z0-9_]{1,80}$/.test(error.message)
              ? error.message : 'FORESIGHT_MAIN_FAILED',
          },
        }, location.origin),
      )
    })
  },
})
