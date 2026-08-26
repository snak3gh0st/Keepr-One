import { FORESIGHT_FLEXLIFE_FIELDS } from '../lib/foresight-target'
import { isForesightPdf, parseForesightReportUrl } from '../lib/foresight-report'

const CHANNEL = 'FYNTRA_FORESIGHT_CONNECTOR_V1'
const MAIN_FRAME_ID = 'ctl00_mobilityPH_iframeMain'
type CarrierWindow = Window & { $find?: (id: string) => unknown }

type MainRequest = {
  type: 'APPLY_CLIENT' | 'APPLY_LEDGER' | 'APPLY_ALLOCATION' | 'CAPTURE_REPORT'
  token: string
  correlationId: string
  values: Record<string, string | number>
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function request(value: unknown): MainRequest | null {
  if (!object(value) || !['APPLY_CLIENT', 'APPLY_LEDGER', 'APPLY_ALLOCATION', 'CAPTURE_REPORT'].includes(String(value.type)) ||
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
      invoke(win, 'ctl00_mobilityPH_panelPremium_ucPremium_rdoPremiumSolves', 'set_Value', 0)
      setSelect(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.premiumType, '-4')
      setInput(doc, FORESIGHT_FLEXLIFE_FIELDS.ledger.premiumAmount, String(values.premiumAmount))
      invoke(win, 'ctl00_mobilityPH_panelPremium_ucPremium', 'updatePremiumSchedule')
      await delay(1_100)
    }
    const applyAllocation = async () => {
      const { doc } = carrier()
      const preference = element<HTMLSelectElement>(
        doc,
        'ctl00_mobilityPH_panelInterestRates_cboPremiumAllocationPreference',
      )
      preference.value = '24'
      preference.dispatchEvent(new Event('change', { bubbles: true }))
      await delay(1_000)
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
          : value.type === 'APPLY_ALLOCATION' ? applyAllocation()
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
