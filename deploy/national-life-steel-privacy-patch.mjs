import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const steelPluginRegistration = `await server.register(steelBrowserPlugin, {
        fileStorage: {
            maxSizePerSession: 100 * MB,
        },
    });`

const hardenedSteelPluginRegistration = `await server.register(steelBrowserPlugin, {
        logging: {
            enableStorage: false,
            enableConsoleLogging: false,
            enableLogsRoutes: false,
        },
        fileStorage: {
            maxSizePerSession: 100 * MB,
        },
    });`

const inMemoryEventStorage = `    else {
        // Use in-memory storage for development
        storage = new InMemoryStorage(1000);
        await storage.initialize();
        fastify.log.info("Using in-memory log storage");
    }`

const disabledEventStorage = `    else {
        storage = null;
    }`

const internalViewerWebSocket = `          const baseWsUrl = '<%= wsUrl %>';`

const signedBrokerViewerWebSocket = `          const baseWsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          const baseWsUrl = \`\${baseWsProtocol}//\${window.location.host}/viewer\`;`

export function patchSteelBuildSources({
  indexSource,
  browserPluginSource,
  viewerTemplateSource,
}) {
  return {
    indexSource: replaceExactlyOnce(
      indexSource,
      steelPluginRegistration,
      hardenedSteelPluginRegistration,
      'Steel plugin registration',
    ),
    browserPluginSource: replaceExactlyOnce(
      browserPluginSource,
      inMemoryEventStorage,
      disabledEventStorage,
      'Steel in-memory event storage',
    ),
    viewerTemplateSource: replaceExactlyOnce(
      viewerTemplateSource,
      internalViewerWebSocket,
      signedBrokerViewerWebSocket,
      'Steel viewer WebSocket origin',
    ),
  }
}

function replaceExactlyOnce(source, target, replacement, label) {
  const firstIndex = source.indexOf(target)
  if (firstIndex < 0 || source.indexOf(target, firstIndex + target.length) >= 0) {
    throw new Error(`${label} did not match the reviewed Steel build`)
  }
  return source.replace(target, replacement)
}

async function patchPinnedSteelBuild() {
  const buildDirectory = '/app/api/build'
  const indexPath = path.join(buildDirectory, 'index.js')
  const browserPluginPath = path.join(buildDirectory, 'plugins/browser.js')
  const viewerTemplatePath = path.join(
    buildDirectory,
    'templates/live-session-streamer.ejs',
  )
  const [indexSource, browserPluginSource, viewerTemplateSource] =
    await Promise.all([
      readFile(indexPath, 'utf8'),
      readFile(browserPluginPath, 'utf8'),
      readFile(viewerTemplatePath, 'utf8'),
    ])
  const patched = patchSteelBuildSources({
    indexSource,
    browserPluginSource,
    viewerTemplateSource,
  })
  await Promise.all([
    writeFile(indexPath, patched.indexSource),
    writeFile(browserPluginPath, patched.browserPluginSource),
    writeFile(viewerTemplatePath, patched.viewerTemplateSource),
  ])
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await patchPinnedSteelBuild()
}
