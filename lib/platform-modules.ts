import type { PlatformPlanName } from '@/lib/plans'

export const PLATFORM_MODULES = [
  'TODAY',
  'CALENDAR',
  'CRM',
  'MESSAGES',
  'POLICIES',
  'ILLUSTRATIONS',
  'COMMISSIONS',
  'JOURNEY',
  'AGENCY',
  'TEAM',
  'INTEGRATIONS',
] as const

export type PlatformModuleName = (typeof PLATFORM_MODULES)[number]
export type PlatformModuleLanguage = 'PT' | 'EN'

type PlatformModuleCopy = {
  label: Record<PlatformModuleLanguage, string>
  description: Record<PlatformModuleLanguage, string>
}

export const PLATFORM_MODULE_CATALOG = {
  TODAY: {
    label: { PT: 'Hoje', EN: 'Today' },
    description: {
      PT: 'Resumo diário, prioridades e próximos passos.',
      EN: 'Daily overview, priorities, and next steps.',
    },
  },
  CALENDAR: {
    label: { PT: 'Agenda', EN: 'Calendar' },
    description: {
      PT: 'Compromissos, disponibilidade e links de agendamento.',
      EN: 'Appointments, availability, and scheduling links.',
    },
  },
  CRM: {
    label: { PT: 'CRM', EN: 'CRM' },
    description: {
      PT: 'Oportunidades, clientes e atividades comerciais.',
      EN: 'Opportunities, clients, and sales activities.',
    },
  },
  MESSAGES: {
    label: { PT: 'Mensagens', EN: 'Messages' },
    description: {
      PT: 'Conversas e canais de atendimento conectados.',
      EN: 'Connected conversations and service channels.',
    },
  },
  POLICIES: {
    label: { PT: 'Apólices', EN: 'Policies' },
    description: {
      PT: 'Carteira, documentos e acompanhamento de apólices.',
      EN: 'Policy book, documents, and policy tracking.',
    },
  },
  ILLUSTRATIONS: {
    label: { PT: 'Ilustrações', EN: 'Illustrations' },
    description: {
      PT: 'Cotações e ilustrações para propostas.',
      EN: 'Quotes and illustrations for proposals.',
    },
  },
  COMMISSIONS: {
    label: { PT: 'Comissões', EN: 'Commissions' },
    description: {
      PT: 'Produção, lançamentos e valores de comissão.',
      EN: 'Production, entries, and commission amounts.',
    },
  },
  JOURNEY: {
    label: { PT: 'Jornada', EN: 'Journey' },
    description: {
      PT: 'Metas, progresso e reconhecimento da carreira.',
      EN: 'Goals, progress, and career recognition.',
    },
  },
  AGENCY: {
    label: { PT: 'Agência', EN: 'Agency' },
    description: {
      PT: 'Gestão comercial da agência e de seus convites.',
      EN: 'Commercial agency and invitation management.',
    },
  },
  TEAM: {
    label: { PT: 'Equipe', EN: 'Team' },
    description: {
      PT: 'Estrutura, vínculos e visão da equipe.',
      EN: 'Team structure, relationships, and overview.',
    },
  },
  INTEGRATIONS: {
    label: { PT: 'Integrações', EN: 'Integrations' },
    description: {
      PT: 'Conexões com Google Agenda, National Life e outros serviços.',
      EN: 'Connections to Google Calendar, National Life, and other services.',
    },
  },
} as const satisfies Record<PlatformModuleName, PlatformModuleCopy>

const INDIVIDUAL_DEFAULT_MODULES = [
  'TODAY',
  'CALENDAR',
  'CRM',
  'MESSAGES',
  'POLICIES',
  'ILLUSTRATIONS',
  'COMMISSIONS',
  'JOURNEY',
  'INTEGRATIONS',
] as const satisfies readonly PlatformModuleName[]

/**
 * Plan defaults are only a starting point for administrative provisioning.
 * The persisted AdminProvisionedAccess.modules list remains authoritative.
 */
export const DEFAULT_PLATFORM_MODULES_BY_PLAN: Readonly<
  Record<PlatformPlanName, readonly PlatformModuleName[]>
> = {
  AGENT_INDIVIDUAL: INDIVIDUAL_DEFAULT_MODULES,
  AGENCY: PLATFORM_MODULES,
  // This plan is invitation-owned today, but keeping an explicit default makes
  // the catalog total and prevents callers from inventing a third policy.
  AGENT_AGENCY_MEMBER: INDIVIDUAL_DEFAULT_MODULES,
}

// Short alias used by the administrative form.
export const DEFAULT_MODULES_BY_PLAN = DEFAULT_PLATFORM_MODULES_BY_PLAN

const PLATFORM_MODULE_SET = new Set<string>(PLATFORM_MODULES)

/**
 * Returns a canonical, de-duplicated module list in product-navigation order.
 * TODAY is the authenticated agent baseline and cannot be removed.
 */
export function normalizePlatformModules(input: unknown): PlatformModuleName[] {
  const selected = new Set<PlatformModuleName>(['TODAY'])

  if (Array.isArray(input)) {
    for (const value of input) {
      if (typeof value === 'string' && PLATFORM_MODULE_SET.has(value)) {
        selected.add(value as PlatformModuleName)
      }
    }
  }

  return PLATFORM_MODULES.filter((module) => selected.has(module))
}

type ModuleRoute = {
  path: string
  module: PlatformModuleName
  exact?: boolean
}

const MODULE_ROUTES: readonly ModuleRoute[] = [
  { path: '/agent', module: 'TODAY', exact: true },
  { path: '/agent/calendar', module: 'CALENDAR' },
  { path: '/agent/cases', module: 'CRM' },
  { path: '/agent/clients', module: 'CRM' },
  { path: '/agent/activities', module: 'CRM' },
  { path: '/agent/mensagens', module: 'MESSAGES' },
  { path: '/agent/policies', module: 'POLICIES' },
  { path: '/agent/illustrations', module: 'ILLUSTRATIONS' },
  { path: '/agent/commissions', module: 'COMMISSIONS' },
  { path: '/agent/journey', module: 'JOURNEY' },
  { path: '/agent/agency', module: 'AGENCY' },
  { path: '/agent/hierarchy', module: 'TEAM' },
  { path: '/agent/integrations', module: 'INTEGRATIONS' },
  { path: '/api/agent/calendar', module: 'CALENDAR' },
  { path: '/api/agent/scheduling', module: 'CALENDAR' },
  { path: '/api/agent/messaging', module: 'MESSAGES' },
  { path: '/api/agent/integrations', module: 'INTEGRATIONS' },
  { path: '/api/agent/carrier-sync', module: 'INTEGRATIONS' },
  { path: '/api/agent/notifications', module: 'TODAY' },
  { path: '/api/documents', module: 'POLICIES' },
  { path: '/api/illustrations', module: 'ILLUSTRATIONS' },
]

function canonicalPathname(pathname: string): string {
  const withoutQuery = pathname.split(/[?#]/, 1)[0] || '/'
  if (withoutQuery === '/') return withoutQuery
  return withoutQuery.endsWith('/') ? withoutQuery.slice(0, -1) : withoutQuery
}

function matchesRoute(pathname: string, route: ModuleRoute): boolean {
  if (route.exact) return pathname === route.path
  return pathname === route.path || pathname.startsWith(`${route.path}/`)
}

/** Returns null for operational routes such as settings, billing, and auth. */
export function getPlatformModuleForPath(pathname: string): PlatformModuleName | null {
  const normalizedPathname = canonicalPathname(pathname)
  return MODULE_ROUTES.find((route) => matchesRoute(normalizedPathname, route))?.module ?? null
}
