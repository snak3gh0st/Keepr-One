export const IGO_ORIGINS = {
  nationalLife: 'https://www.nationallife.com',
  auth0: 'https://nlg-prod.auth0.com',
  passThrough: 'https://pipepasstoigo.ipipeline.com',
  federation: 'https://federate.ipipeline.com',
  forms: 'https://igoforms2.ipipeline.com',
} as const

export type IgoLocation =
  | 'NATIONAL_LIFE_LAUNCHER'
  | 'AUTH_REQUIRED'
  | 'MFA_REQUIRED'
  | 'IPIPELINE_GATEWAY'
  | 'IPIPELINE_FEDERATION'
  | 'IGO_FORMS'
  | 'UNEXPECTED_ORIGIN'
  | 'INVALID_URL'

export function classifyIgoLocation(value: string): IgoLocation {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'INVALID_URL'
  }
  if (url.origin === IGO_ORIGINS.nationalLife && url.pathname === '/agent/sso/igo-eapp') {
    return 'NATIONAL_LIFE_LAUNCHER'
  }
  if (url.origin === IGO_ORIGINS.auth0) {
    return /\/mfa|\/challenge/i.test(url.pathname) ? 'MFA_REQUIRED' : 'AUTH_REQUIRED'
  }
  if (url.origin === IGO_ORIGINS.passThrough) return 'IPIPELINE_GATEWAY'
  if (url.origin === IGO_ORIGINS.federation) return 'IPIPELINE_FEDERATION'
  if (url.origin === IGO_ORIGINS.forms) return 'IGO_FORMS'
  return 'UNEXPECTED_ORIGIN'
}

export function isApprovedIgoOrigin(origin: string): boolean {
  return origin === IGO_ORIGINS.passThrough || origin === IGO_ORIGINS.federation ||
    origin === IGO_ORIGINS.forms
}
