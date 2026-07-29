import type { Browser, BrowserContext, Page } from 'playwright-core'

export type NationalLifeCaseObservation = {
  externalApplicationId: string
  carrierStatus: string
  observedAt: string
  requirements: Array<{
    externalId: string
    title: string
    description?: string
    carrierStatus: string
    dueAt?: string
  }>
  communications: Array<{
    externalId: string
    title: string
    body?: string
    occurredAt: string
  }>
  documents: Array<{
    externalId: string
    filename: string
    contentType?: string
    availableAt?: string
  }>
}

export type AdapterRunResult =
  | { kind: 'CONNECTED' }
  | { kind: 'MFA_REQUIRED'; resumeHint: string }
  | { kind: 'CASE_OBSERVED'; observation: NationalLifeCaseObservation }

export type BrowserSessionContinuation = Readonly<{
  steelSessionId: string
  debugUrl: string
  expiresAt: string
}>

export type BrowserSession = Readonly<{
  browser: Browser
  context: BrowserContext
  page: Page
  steelSessionId: string
  debugUrl: string
  close(): Promise<void>
  disconnect(): Promise<void>
}>

export type InteractiveBrowserSession = BrowserSession & {
  internalDebugUrl: string
}
