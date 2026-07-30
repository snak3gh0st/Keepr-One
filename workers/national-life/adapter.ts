import { ZodError, z } from 'zod'
import {
  RAPID_SOLVE_HEADERS,
  RAPID_SOLVE_PAGE_PATH,
  RAPID_SOLVE_PATH,
  parseRapidSolveResponse,
  type RapidSolveFailure,
  type RapidSolveQuote,
  type RapidSolveRequest,
} from '../../lib/national-life/rapid-solve'
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

type AdapterRequestResponse = {
  ok(): boolean
  status(): number
  json(): Promise<unknown>
  text(): Promise<string>
}

type AdapterPage = {
  goto(url: string, options?: { waitUntil?: 'domcontentloaded'; timeout?: number }): Promise<void>
  getByLabel(label: string): AdapterLocator
  getByRole(role: 'button' | 'heading' | 'link', options?: { name?: string }): AdapterLocator
  locator(selector: string): AdapterLocator
  url(): string
  request: {
    post(
      url: string,
      options: { data: unknown; headers?: Record<string, string> },
    ): Promise<AdapterRequestResponse>
  }
}

const SELECTOR_NOT_FOUND_CODE = 'SELECTOR_NOT_FOUND'
const PORTAL_LAYOUT_CHANGED_CODE = 'PORTAL_LAYOUT_CHANGED'
const UNEXPECTED_APPLICATION_IDENTIFIER_CODE = 'UNEXPECTED_APPLICATION_IDENTIFIER'
const AUTHENTICATION_STATE_INVALID_CODE = 'AUTHENTICATION_STATE_INVALID'
const NAVIGATION_ORIGIN_BLOCKED_CODE = 'NAVIGATION_ORIGIN_BLOCKED'
const RAPID_SOLVE_REQUEST_FAILED_CODE = 'RAPID_SOLVE_REQUEST_FAILED'

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

  /// Puts the session on the carrier's own site before anything asks whether it
  /// is still authenticated.
  ///
  /// A restored Steel session opens blank, and `about:blank` has no origin the
  /// allowlist can accept — so `assertAuthenticated` rejected every job before
  /// it did any work, reporting a navigation the job had never attempted. The
  /// keep-alive script proves a session the same way, by loading `/agent/`.
  async openPortalHome(): Promise<void> {
    try {
      await this.getPage().goto(new URL('/agent/', this.config.loginUrl).toString(), {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      })
    } catch (error) {
      throw this.normalizeError(error)
    }
  }

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

      const carrierMarkerCount = await page
        .locator(`[data-carrier-id="${this.config.carrierId}"]`)
        .count()

      if (carrierMarkerCount === 1) {
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
      }

      if (carrierMarkerCount > 1) {
        throw this.toPortalLayoutChanged()
      }

      return this.classifyHostedAuthentication(currentUrl)
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

  /// Asks the carrier to price an illustration.
  ///
  /// This is the only call in the integration that is not a read. It creates no
  /// application and files nothing — Rapid Solve is the carrier's own quoting
  /// tool and this is the request its screen makes — but it is still a POST
  /// against a real agent account, which is why it goes through the session's
  /// own browser context rather than a bare fetch, and why nothing calls it
  /// except a job the agent triggered.
  ///
  /// A refusal is returned, not thrown: `Success: false` arrives with HTTP 200
  /// and carries the carrier's own sentence about why. That sentence is the
  /// answer the agent needs, and an exception would send it through error
  /// redaction instead of to the screen.
  async requestRapidSolveQuote(
    request: RapidSolveRequest,
  ): Promise<RapidSolveQuote | RapidSolveFailure> {
    try {
      const page = this.getPage()

      // Posted from the tool's own page, the way the carrier's script does it.
      // The first attempt posted from elsewhere in the portal and the endpoint
      // answered HTTP 500.
      await page.goto(new URL(RAPID_SOLVE_PAGE_PATH, this.config.loginUrl).toString(), {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      })

      const url = new URL(RAPID_SOLVE_PATH, this.config.loginUrl).toString()
      const response = await page.request.post(url, {
        data: request,
        headers: RAPID_SOLVE_HEADERS,
      })

      // Transport-level failure is a real failure: we never got an answer.
      if (!response.ok()) {
        // The server's own account of what went wrong. Three attempts were
        // spent guessing at a 500 while this was being thrown away — ASP.NET
        // puts the exception type in the body, and reading it beats another
        // round of changing one thing and asking the carrier again.
        let body = ''
        try {
          body = (await response.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        } catch {
          body = '[unreadable]'
        }

        throw new NationalLifeAdapterError(
          RAPID_SOLVE_REQUEST_FAILED_CODE,
          'National Life did not answer the Rapid Solve request',
          { status: response.status(), body: body.slice(0, 600) },
        )
      }

      return parseRapidSolveResponse(await response.json())
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

  private classifyHostedAuthentication(
    currentUrl: URL,
  ): NationalLifeAuthenticationState {
    const loginUrl = new URL(this.config.loginUrl)
    const returnUrl = resolveSameOriginReturnUrl(loginUrl)

    if (!returnUrl) {
      throw this.toPortalLayoutChanged()
    }

    if (currentUrl.origin !== loginUrl.origin) {
      return { kind: 'AWAITING_LOGIN', origin: currentUrl.origin }
    }

    const loginDirectory = loginUrl.pathname.slice(
      0,
      loginUrl.pathname.lastIndexOf('/') + 1,
    )
    if (
      currentUrl.pathname === loginUrl.pathname ||
      currentUrl.pathname.startsWith(loginDirectory)
    ) {
      return { kind: 'AWAITING_LOGIN', origin: currentUrl.origin }
    }

    if (isPathWithin(currentUrl.pathname, returnUrl.pathname)) {
      return { kind: 'AUTHENTICATED', origin: currentUrl.origin }
    }

    throw this.toPortalLayoutChanged()
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

function resolveSameOriginReturnUrl(loginUrl: URL) {
  const returnUrlValue = loginUrl.searchParams.get('returnUrl')
  if (!returnUrlValue) {
    return null
  }

  const returnUrl = new URL(returnUrlValue, loginUrl.origin)
  return returnUrl.origin === loginUrl.origin ? returnUrl : null
}

function isPathWithin(pathname: string, parentPathname: string) {
  const normalizedParent = parentPathname.endsWith('/')
    ? parentPathname
    : `${parentPathname}/`
  return (
    pathname === normalizedParent.slice(0, -1) ||
    pathname.startsWith(normalizedParent)
  )
}
