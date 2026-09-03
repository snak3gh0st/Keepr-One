import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'wxt'
import { extensionIdFromManifestKey, normalizeManifestKey } from './lib/manifest-key'

const keeprOrigin = new URL(process.env.WXT_KEEPR_ORIGIN ?? 'https://app.keeprone.com').origin
const officialKeeprOrigin = 'https://app.keeprone.com'
const officialExtensionId = 'anfhdbmapiohhbplmccimflcenijfnoi'
const localhostOrigin = 'http://localhost:3000'
if (![officialKeeprOrigin, localhostOrigin].includes(keeprOrigin)) {
  throw new Error('WXT_KEEPR_ORIGIN must be Keepr production or localhost')
}
// Chrome match patterns do not include ports. Keep the exact origin (including
// :3000) for signed API requests, but grant the local page through the valid
// host pattern so window.chrome.runtime is exposed to localhost.
const keeprMatchOrigin = keeprOrigin === localhostOrigin ? 'http://localhost' : keeprOrigin

const manifestKeyPath = resolve(__dirname, '.keys/manifest-key.txt')
const manifestKey = existsSync(manifestKeyPath)
  ? normalizeManifestKey(readFileSync(manifestKeyPath, 'utf8'))
  : undefined
const isChromeWebStoreBuild = process.env.WXT_CHROME_WEB_STORE === 'true'
if (
  !isChromeWebStoreBuild &&
  keeprOrigin === officialKeeprOrigin &&
  manifestKey &&
  extensionIdFromManifestKey(manifestKey) !== officialExtensionId
) {
  throw new Error(
    `The unpacked production build must use the official K-Bot extension identity ${officialExtensionId}`,
  )
}

export default defineConfig({
  manifest: {
    name: 'K-Bot by KeeprOne',
    description: 'K-Bot sincroniza a National Life e cria ilustrações oficiais no seu navegador, com segurança.',
    version: '0.1.77',
    // Chrome Web Store rejects the development-only key field. Keep it for
    // unpacked local builds so the smoke-test extension retains its stable ID.
    ...(!isChromeWebStoreBuild && manifestKey ? { key: manifestKey } : {}),
    permissions: ['storage', 'tabs', 'alarms'],
    host_permissions: [
      'https://www.nationallife.com/*',
      'https://nlg-prod.auth0.com/*',
      'https://pipepasstoigo.ipipeline.com/*',
      'https://federate.ipipeline.com/*',
      'https://igoforms2.ipipeline.com/*',
      `${keeprMatchOrigin}/*`,
    ],
    externally_connectable: {
      matches: [`${keeprMatchOrigin}/*`],
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
  },
  vite: () => ({
    define: {
      __KEEPR_ORIGIN__: JSON.stringify(keeprOrigin),
    },
  }),
})
