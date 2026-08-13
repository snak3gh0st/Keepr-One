import 'server-only'

const CHROME_EXTENSION_ID = /^[a-p]{32}$/
const CHROME_WEB_STORE_HOST = 'chromewebstore.google.com'

export const LOCAL_CONNECTOR_DEPLOYMENT_SCOPE = 'LOCAL_CONNECTOR'

export type LocalConnectorInstallMode = 'pilot' | 'store'

export type PublicLocalConnectorConfig =
  | { enabled: false }
  | {
      enabled: true
      extensionId: string
      installMode: LocalConnectorInstallMode
      /** Official Chrome Web Store listing; null in pilot (unpacked) mode. */
      storeUrl: string | null
      baseUrl: string
    }

function parseEnabled(value: string | undefined): boolean {
  if (value === undefined || value === '') return false
  if (value !== 'true' && value !== 'false') {
    throw new Error('NATIONAL_LIFE_LOCAL_CONNECTOR_ENABLED must be true or false')
  }
  return value === 'true'
}

function parseOptionalFlag(name: string, value: string | undefined): boolean {
  if (value === undefined || value === '') return false
  if (value !== 'true' && value !== 'false') {
    throw new Error(`${name} must be true or false`)
  }
  return value === 'true'
}

function parseExtensionId(value: string | undefined): string {
  const extensionId = value?.trim() ?? ''
  if (!CHROME_EXTENSION_ID.test(extensionId)) {
    throw new Error('NATIONAL_LIFE_LOCAL_CONNECTOR_EXTENSION_ID must be a valid Chrome extension ID')
  }
  return extensionId
}

function parseStoreUrl(value: string | undefined, extensionId: string): string {
  let url: URL
  try {
    url = new URL(value ?? '')
  } catch {
    throw new Error('NATIONAL_LIFE_LOCAL_CONNECTOR_STORE_URL must be a valid HTTPS URL')
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== CHROME_WEB_STORE_HOST ||
    url.username ||
    url.password ||
    url.hash ||
    !url.pathname.split('/').includes(extensionId)
  ) {
    throw new Error(
      'NATIONAL_LIFE_LOCAL_CONNECTOR_STORE_URL must be the official Chrome Web Store URL for the configured extension',
    )
  }
  return url.toString()
}

function parseAppOrigin(value: string | undefined): string {
  let url: URL
  try {
    url = new URL(value ?? '')
  } catch {
    throw new Error('BETTER_AUTH_URL must identify the Keepr One app origin')
  }
  const isHttps = url.protocol === 'https:'
  const isLocalDev =
    process.env.NODE_ENV !== 'production' &&
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  if (
    (!isHttps && !isLocalDev) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('BETTER_AUTH_URL must be an HTTPS origin (localhost HTTP is allowed in development)')
  }
  return url.origin
}

export function getNationalLifeLocalConnectorConfig(): PublicLocalConnectorConfig {
  if (!parseEnabled(process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_ENABLED)) {
    return { enabled: false }
  }

  const extensionId = parseExtensionId(process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_EXTENSION_ID)
  const rawStoreUrl = process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_STORE_URL?.trim()
  const baseUrl = parseAppOrigin(process.env.BETTER_AUTH_URL)

  // Empty / unset Store URL = pilot (unpacked extension). Store listing is Phase 6.
  if (!rawStoreUrl) {
    return {
      enabled: true,
      extensionId,
      installMode: 'pilot',
      storeUrl: null,
      baseUrl,
    }
  }

  return {
    enabled: true,
    extensionId,
    installMode: 'store',
    storeUrl: parseStoreUrl(rawStoreUrl, extensionId),
    baseUrl,
  }
}

export function isNationalLifeLocalConnectorEnabled(): boolean {
  return getNationalLifeLocalConnectorConfig().enabled
}

/// READ_PAGE is intentionally rolled out separately from the established grid
/// sync. Chrome Web Store clients that predate the page collector must keep
/// receiving the proven 13-grid plan until the new package is installed.
export function isNationalLifePageDiscoveryEnabled(): boolean {
  return parseOptionalFlag(
    'NATIONAL_LIFE_LOCAL_CONNECTOR_PAGE_DISCOVERY_ENABLED',
    process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_PAGE_DISCOVERY_ENABLED,
  )
}

/// The official XLSX collector is independently gated because it changes the
/// in-force source from paginated reads to one authenticated carrier export.
export function isNationalLifeExportEnabled(): boolean {
  return parseOptionalFlag(
    'NATIONAL_LIFE_LOCAL_CONNECTOR_EXPORT_ENABLED',
    process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_EXPORT_ENABLED,
  )
}

export function localConnectorUnavailableResponse(): Response {
  return Response.json(
    { error: 'NOT_AVAILABLE' },
    { status: 404, headers: { 'Cache-Control': 'no-store' } },
  )
}
