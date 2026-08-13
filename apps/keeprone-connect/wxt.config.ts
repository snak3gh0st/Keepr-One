import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'wxt'

const keeprOrigin = new URL(process.env.WXT_KEEPR_ORIGIN ?? 'https://app.keeprone.com').origin
const localhostOrigin = 'http://localhost:3000'
if (!['https://app.keeprone.com', localhostOrigin].includes(keeprOrigin)) {
  throw new Error('WXT_KEEPR_ORIGIN must be Keepr production or localhost')
}

const manifestKeyPath = resolve(__dirname, '.keys/manifest-key.txt')
const manifestKey = existsSync(manifestKeyPath)
  ? readFileSync(manifestKeyPath, 'utf8').trim()
  : undefined
const isChromeWebStoreBuild = process.env.WXT_CHROME_WEB_STORE === 'true'

export default defineConfig({
  manifest: {
    name: 'KeeproneConnect',
    description: 'KeeproneConnect sincroniza dados do National Life no seu navegador, com segurança.',
    version: '0.1.12',
    // Chrome Web Store rejects the development-only key field. Keep it for
    // unpacked local builds so the smoke-test extension retains its stable ID.
    ...(!isChromeWebStoreBuild && manifestKey ? { key: manifestKey } : {}),
    permissions: ['storage', 'tabs', 'alarms'],
    host_permissions: ['https://www.nationallife.com/*', `${keeprOrigin}/*`],
    externally_connectable: {
      matches: [`${keeprOrigin}/*`],
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
