import { ZodError, z } from 'zod'
import type { BrowserSession, NationalLifeCaseObservation } from './types'

export type AdapterConfig = Readonly<{
  carrierId: 'NATIONAL_LIFE'
  loginUrl: string
  caseSearchUrl: string
  allowedOrigins?: readonly string[]
  now?: () => Date
}>

type AdapterLocator = {
  count(): Promise<number>
  nth(index: number): AdapterLocator
  locator(selector: string): AdapterLocator
  textContent(): Promise<string | null>
  getAttribute(name: string): Promise<string | null>
  fill(value: string): Promise<void>
  click(): Promise<void>
}

type AdapterPage = {
  goto(url: string): Promise<void>
  getByLabel(label: string): AdapterLocator
  getByRole(role: 'button' | 'heading' | 'link', options?: { name?: string }): AdapterLocator
  locator(selector: string): AdapterLocator
  url(): string
}

const SELECTOR_NOT_FOUND_CODE = 'SELECTOR_NOT_FOUND'
const PORTAL_LAYOUT_CHANGED_CODE = 'PORTAL_LAYOUT_CHANGED'
const UNEXPECTED_APPLICATION_IDENTIFIER_CODE = 'UNEXPECTED_APPLICATION_IDENTIFIER'
const AUTHENTICATION_STATE_INVALID_CODE = 'AUTHENTICATION_STATE_INVALID'
const NAVIGATION_ORIGIN_BLOCKED_CODE = 'NAVIGATION_ORIGIN_BLOCKED'

export type NationalLifeAuthenticationState =
  | { kind: 'AWAITING_LOGIN'; origin: string }
  | { kind: 'AWAITING_MFA'; origin: string }
  | { kind: 'AUTHENTICATED'; origin: string }

const requirementSchema = z.object({
  externalId: z.string().min(1),
  title: z.string().min(1),
  carrierStatus: z.string().min(1),
  dueAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
})

const observationSchema: z.ZodType<NationalLifeCaseObservation> = z.object({
  externalApplicationId: z.string().min(1),
  carrierStatus: z.string().min(1),
  observedAt: z.string().datetime({ offset: true }),
  requirements: z.array(requirementSchema),
  communications: z.array(
    z.object({
      externalId: z.string().min(1),
      title: z.string().min(1),
      body: z.string().optional(),
      occurredAt: z.string().datetime({ offset: true }),
    }),
  ),
  documents: z.array(
    z.object({
      externalId: z.string().min(1),
      filename: z.string().min(1),
      contentType: z.string().optional(),
      availableAt: z.string().datetime({ offset: true }).optional(),
    }),
  ),
})

export class NationalLifeAdapterError extends Error {
  code: string
  safeDetail?: unknown

  constructor(code: string, message: string, safeDetail?: unknown) {
    super(message)
    this.code = code
    this.safeDetail = safeDetail
  }
}

export class NationalLifeAdapter {
  constructor(
    private readonly session: BrowserSession,
    private readonly config: AdapterConfig,
  ) {}

  async classifyAuthenticationState(): Promise<NationalLifeAuthenticationState> {
    try {
      const page = this.getPage()
      const currentUrl = new URL(page.url())
      const allowedOrigins = new Set(
        (this.config.allowedOrigins ?? [
          new URL(this.config.loginUrl).origin,
          new URL(this.config.caseSearchUrl).origin,
        ]).map((origin) => new URL(origin).origin),
      )
      if (!allowedOrigins.has(currentUrl.origin)) {
        throw new NationalLifeAdapterError(
          NAVIGATION_ORIGIN_BLOCKED_CODE,
          'National Life navigation origin is not allowed',
        )
      }

      await this.requireCarrierMarker()

      if (await this.hasPortalPage('login')) {
        return { kind: 'AWAITING_LOGIN', origin: currentUrl.origin }
      }
      if (await this.hasPortalPage('mfa')) {
        return { kind: 'AWAITING_MFA', origin: currentUrl.origin }
      }
      if (await this.hasPortalPage('case-results')) {
        return { kind: 'AUTHENTICATED', origin: currentUrl.origin }
      }

      throw this.toPortalLayoutChanged()
    } catch (error) {
      throw this.normalizeError(error)
    }
  }

  async assertAuthenticated(): Promise<void> {
    const state = await this.classifyAuthenticationState()
    if (state.kind !== 'AUTHENTICATED') {
      throw new NationalLifeAdapterError(
        AUTHENTICATION_STATE_INVALID_CODE,
        'National Life session is not authenticated',
      )
    }
  }

  async readCase(lookup: { kind: 'EXTERNAL_ID'; value: string }): Promise<NationalLifeCaseObservation> {
    try {
      const page = this.getPage()

      await page.goto(this.config.caseSearchUrl)
      await this.assertAuthenticated()
      await page.getByLabel('External application ID').fill(lookup.value)
      await page.getByRole('button', { name: 'Search' }).click()
      await page.getByRole('link', { name: `Open application ${lookup.value}` }).click()
      await this.requireCarrierPage()

      const externalApplicationId = await this.requireText(
        page.locator('[data-field="application-id"]'),
        'application identifier',
      )

      if (externalApplicationId !== lookup.value) {
        throw new NationalLifeAdapterError(
          UNEXPECTED_APPLICATION_IDENTIFIER_CODE,
          'Carrier application identifier did not match the requested external application id',
          {
            expectedExternalId: lookup.value,
            actualExternalId: externalApplicationId,
          },
        )
      }

      const carrierStatus = await this.requireText(page.locator('[data-field="case-status"]'), 'case status')
      const observedAt = (this.config.now ?? (() => new Date()))().toISOString()
      const requirementRows = page.locator('table[aria-label="Requirements"] tr')
      const requirementCount = await requirementRows.count()
      const requirements: NationalLifeCaseObservation['requirements'] = []

      for (let index = 0; index < requirementCount; index += 1) {
        const row = requirementRows.nth(index)
        const externalId = this.requireValue(await row.getAttribute('data-requirement-id'), 'requirement id')
        const title = await this.requireText(row.locator('[data-column="title"]'), 'requirement title')
        const requirementStatus = await this.requireText(
          row.locator('[data-column="status"]'),
          'requirement status',
        )
        const dueAt = await this.requireText(row.locator('[data-column="due-at"]'), 'requirement due date')

        requirements.push({
          externalId,
          title,
          carrierStatus: requirementStatus,
          dueAt,
        })
      }

      return observationSchema.parse({
        externalApplicationId,
        carrierStatus,
        observedAt,
        requirements,
        communications: [],
        documents: [],
      })
    } catch (error) {
      throw this.normalizeError(error)
    }
  }

  private getPage(): AdapterPage {
    return this.session.page as unknown as AdapterPage
  }

  private async requireCarrierPage(expectedPage?: string) {
    await this.requireCarrierMarker()

    if (!expectedPage) {
      return
    }

    const count = await this.getPage()
      .locator(`[data-portal-page="${expectedPage}"]`)
      .count()

    if (count !== 1) {
      throw new NationalLifeAdapterError(SELECTOR_NOT_FOUND_CODE, `Expected carrier page ${expectedPage}`)
    }
  }

  private async requireCarrierMarker() {
    const count = await this.getPage()
      .locator(`[data-carrier-id="${this.config.carrierId}"]`)
      .count()

    if (count !== 1) {
      throw new NationalLifeAdapterError(SELECTOR_NOT_FOUND_CODE, 'Expected National Life carrier marker')
    }
  }

  private async hasPortalPage(name: string) {
    return (
      (await this.getPage().locator(`[data-portal-page="${name}"]`).count()) === 1
    )
  }

  private async requireText(locator: AdapterLocator, label: string) {
    const count = await locator.count()
    if (count !== 1) {
      throw new NationalLifeAdapterError(SELECTOR_NOT_FOUND_CODE, `Expected ${label}`)
    }

    return this.requireValue(await locator.textContent(), label)
  }

  private requireValue(value: string | null | undefined, label: string) {
    const normalizedValue = normalizeWhitespace(value)

    if (!normalizedValue) {
      throw new NationalLifeAdapterError(SELECTOR_NOT_FOUND_CODE, `Expected ${label}`)
    }

    return normalizedValue
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof NationalLifeAdapterError) {
      if (error.code === SELECTOR_NOT_FOUND_CODE) {
        return this.toPortalLayoutChanged()
      }

      return error
    }

    if (error instanceof ZodError) {
      return this.toPortalLayoutChanged('SCHEMA_VALIDATION_FAILED')
    }

    if (hasErrorCode(error, SELECTOR_NOT_FOUND_CODE)) {
      return this.toPortalLayoutChanged()
    }

    if (error instanceof Error) {
      return error
    }

    return new Error(String(error))
  }

  private toPortalLayoutChanged(safeCode = SELECTOR_NOT_FOUND_CODE) {
    return new NationalLifeAdapterError(PORTAL_LAYOUT_CHANGED_CODE, 'National Life portal layout changed', {
      safeCode,
      portalUrl: this.getPage().url(),
    })
  }
}

function hasErrorCode(error: unknown, code: string): error is Error & { code: string } {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string' &&
    (error as { code: string }).code === code
  )
}

function normalizeWhitespace(value: string | null | undefined) {
  return value?.replace(/\s+/g, ' ').trim() ?? null
}
