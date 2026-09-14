export const NLG_ORIGIN = 'https://www.nationallife.com'
export const NLG_AUTH0_ORIGIN = 'https://nlg-prod.auth0.com'
export const LOGIN_PATH = '/agent/auth/login'

// This module is imported by the server-side parity tests as well as by WXT.
// Keep the declaration beside the compile-time replacement so the root Next.js
// typecheck does not depend on the extension-only globals.d.ts being included.
declare const __KEEPR_ORIGIN__: string

// National Life currently redirects the old menu URL to this authenticated
// grid route. Keep the alias here because an in-flight run can have persisted
// the old server plan before an extension update.
const LEGACY_INFORCE_CLIENTS_PATH =
  '/agent/book-of-business/inforce-book/all-clients'
const CANONICAL_INFORCE_CLIENTS_PATH =
  '/agent/book-of-business/inforce-book/all-clients/all-clients-agent'
const LEGACY_PAID_COMMISSIONS_PATH =
  '/agent/compensation/commissions/paid-commissions'
const REDIRECTED_PAID_COMMISSIONS_PATH =
  '/agent/compensation/commissions/paid-commissions/commissions-earning-report'
const LEGACY_PROJECTED_COMMISSIONS_PATH =
  '/agent/compensation/commissions/projected-commissions'
const LEGACY_PAYABLE_GROSS_COMMISSIONS_PATH =
  '/agent/compensation/commissions/projected-commissions/payable-gross-commissions'
const CANONICAL_PAYABLE_GROSS_COMMISSIONS_PATH =
  '/agent/compensation/commissions/projected-commissions/payable-gross-commissions/personal'
const LEGACY_LIFE_PENDING_LAPSE_PATH =
  '/agent/book-of-business/inforce-book/life-pending-lapse-report'
const CANONICAL_LIFE_PENDING_LAPSE_PATH =
  '/agent/book-of-business/inforce-book/life-pending-lapse-report/personal'

/// Menu routes the carrier redirects to a child page the plan did not name. The
/// stage waits for the URL it asked for, so an unnamed redirect target reads as
/// PORTAL_ROUTE_CHANGED and the stage fails — which is exactly what happened to five
/// reports in the 2026-08-17 run. The server catalogue names the final route now;
/// this table is what keeps a run whose plan was persisted before that deploy working.
///
/// Keyed by grid too, not by path alone: the same menu path can front different
/// reports, and a redirect learned for one grid must not silently retarget another.
const STAGE_PATH_REDIRECTS = new Map<string, string>([
  [`INFORCE_CLIENTS ${LEGACY_INFORCE_CLIENTS_PATH}`, CANONICAL_INFORCE_CLIENTS_PATH],
  // "Projected commissions" is a menu route, not a separate grid. Older runs
  // can still contain it, so land them on the payable report instead of
  // bouncing forever between the menu route and the carrier redirect.
  [
    `PROJECTED_COMMISSIONS ${LEGACY_PROJECTED_COMMISSIONS_PATH}`,
    CANONICAL_PAYABLE_GROSS_COMMISSIONS_PATH,
  ],
  [
    `PAYABLE_GROSS_COMMISSIONS ${LEGACY_PAYABLE_GROSS_COMMISSIONS_PATH}`,
    CANONICAL_PAYABLE_GROSS_COMMISSIONS_PATH,
  ],
  [
    `LIFE_PENDING_LAPSE ${LEGACY_LIFE_PENDING_LAPSE_PATH}`,
    CANONICAL_LIFE_PENDING_LAPSE_PATH,
  ],
  // Verified live against the portal on 2026-08-17. Four land on `/personal` and the
  // placement report lands on `/agent` — the suffix is an observation per report, not
  // a convention to extrapolate.
  [
    'ANNUITY_PAST_DUE_CONTRIBUTIONS /agent/book-of-business/inforce-book/annuity-flow-report/past-due-contribution',
    '/agent/book-of-business/inforce-book/annuity-flow-report/past-due-contribution/personal',
  ],
  [
    'ANNUITY_PAYROLL_FLOW_CHANGES /agent/book-of-business/inforce-book/annuity-flow-report/payroll-flow-changes',
    '/agent/book-of-business/inforce-book/annuity-flow-report/payroll-flow-changes/personal',
  ],
  [
    'PREMIUM_REPORT_AGENCY /agent/book-of-business/inforce-book/premium-report-agency',
    '/agent/book-of-business/inforce-book/premium-report-agency/personal',
  ],
  [
    'LIFE_PERSISTENCY /agent/book-of-business/inforce-book/life-persistency-report',
    '/agent/book-of-business/inforce-book/life-persistency-report/personal',
  ],
  [
    'PLACEMENT_REPORT /agent/book-of-business/new-business/placement-report',
    '/agent/book-of-business/new-business/placement-report/agent',
  ],
])

export function canonicalNationalLifeNavigatePath(gridKey: string, path: string): string {
  return STAGE_PATH_REDIRECTS.get(`${gridKey} ${path}`) ?? path
}

export function matchesNationalLifeStagePath(
  gridKey: string,
  expectedPath: string,
  actualPath: string,
): boolean {
  const canonicalPath = canonicalNationalLifeNavigatePath(gridKey, expectedPath)
  if (actualPath === canonicalPath) return true
  return (
    ((gridKey === 'INFORCE_CLIENTS' &&
      (expectedPath === LEGACY_INFORCE_CLIENTS_PATH || expectedPath === CANONICAL_INFORCE_CLIENTS_PATH) &&
      (actualPath === LEGACY_INFORCE_CLIENTS_PATH || actualPath === CANONICAL_INFORCE_CLIENTS_PATH)) ||
      (gridKey === 'PAID_COMMISSIONS' &&
        expectedPath === LEGACY_PAID_COMMISSIONS_PATH &&
        actualPath === REDIRECTED_PAID_COMMISSIONS_PATH))
  )
}

/// `gridKey` is an opaque label. Which grids exist is the server's knowledge now, so
/// the extension echoes the label back and never interprets it. What is still checked
/// here is its shape — charset and length, never membership in a list — so a label
/// cannot smuggle anything into a URL path, a storage key or an idempotency key. A
/// future grid key outside `[A-Z0-9_]` would need an extension release; that is the
/// one soft coupling left, and it is a shape, not a catalogue.
export function isGridKeyLabel(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && /^[A-Z0-9_]+$/.test(value)
}

export const PRODUCTION_KEEPR_ORIGIN = 'https://app.keeprone.com'
const LOCAL_KEEPR_ORIGIN = 'http://localhost:3000'

export function allowedKeeprOrigins(): readonly string[] {
  if (__KEEPR_ORIGIN__ === PRODUCTION_KEEPR_ORIGIN) return [PRODUCTION_KEEPR_ORIGIN]
  return [PRODUCTION_KEEPR_ORIGIN, LOCAL_KEEPR_ORIGIN]
}

export function normalizeOrigin(value: string): string {
  const url = new URL(value)
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('INVALID_BASE_URL')
  }
  return url.origin
}

export function requireAllowedBaseUrl(value: string): string {
  const origin = normalizeOrigin(value)
  if (!allowedKeeprOrigins().includes(origin)) throw new Error('BASE_URL_NOT_ALLOWED')
  return origin
}

export function isAuthPath(pathname: string): boolean {
  return (
    pathname === LOGIN_PATH ||
    pathname.startsWith('/agent/auth/') ||
    pathname.includes('/login') ||
    pathname.includes('/signin') ||
    pathname.includes('/mfa') ||
    pathname.includes('/challenge')
  )
}

/// Um *callback* de autenticação é a seguradora devolvendo o navegador depois
/// que o login ou o MFA completou — o `?code=...&state=...` que o Auth0 anexa.
///
/// Ele mora sob o mesmo `/agent/auth/` das páginas que *pedem* autenticação, e
/// essa semelhança é uma armadilha com dois lados opostos: `isAuthPath` precisa
/// continuar dizendo "sim" para ele, porque o content script não pode
/// instrumentar a página enquanto a troca do código acontece; e o state machine
/// precisa saber que aqui a autenticação **terminou**, e não começou. Ler a
/// prova de sucesso como pedido de autenticação era o que deixava o agente
/// olhando uma página em branco depois de digitar o MFA.
///
/// Igualdade exata, nunca `includes`: `/agent/auth/mfacallback` contém `/mfa`,
/// e foi exatamente esse substring que classificava a conclusão como pedido.
export function isCarrierAuthCallbackPath(pathname: string): boolean {
  const normalized = pathname.toLowerCase().replace(/\/+$/, '')
  return normalized === '/agent/auth/mfacallback' || normalized === '/agent/auth/logincallback'
}

/// Content scripts are declared for the whole `/agent/*` tree because Chrome
/// match patterns cannot express exclusions. Authentication callbacks live in
/// that same tree, though, and must remain untouched: replacing fetch/XHR while
/// Auth0 or MFA is completing adds risk exactly where the connector should be a
/// passive observer.
export function shouldInstrumentNationalLifePath(pathname: string): boolean {
  return pathname.startsWith('/agent/') && !isAuthPath(pathname)
}
