export const INDIVIDUAL_AGENT_MONTHLY_PRICE_CENTS = 5_990
export const AGENCY_MONTHLY_PRICE_CENTS = 9_990
export const INVITED_AGENT_MONTHLY_PRICE_CENTS = 4_990

export const PLATFORM_PLAN_PRICES_CENTS = {
  AGENT_INDIVIDUAL: INDIVIDUAL_AGENT_MONTHLY_PRICE_CENTS,
  AGENCY: AGENCY_MONTHLY_PRICE_CENTS,
  AGENT_AGENCY_MEMBER: INVITED_AGENT_MONTHLY_PRICE_CENTS,
} as const

export const PLATFORM_PLAN_MONTHLY_PRICE_CENTS = PLATFORM_PLAN_PRICES_CENTS

export type PlatformPlanName = keyof typeof PLATFORM_PLAN_PRICES_CENTS

export function getPlatformPlanPriceCents(plan: PlatformPlanName): number {
  return PLATFORM_PLAN_PRICES_CENTS[plan]
}

export function formatPlanPrice(
  cents: number,
  locale = 'pt-BR',
  currency = 'USD',
): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError('Price cents must be a non-negative safe integer')
  }

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

export function formatPlatformPlanPrice(
  plan: PlatformPlanName,
  locale = 'pt-BR',
  currency = 'USD',
): string {
  return formatPlanPrice(getPlatformPlanPriceCents(plan), locale, currency)
}
