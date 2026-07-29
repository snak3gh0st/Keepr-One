import { describe, expect, it } from 'vitest'
import { patchSteelBuildSources } from './national-life-steel-privacy-patch.mjs'

describe('National Life Steel privacy patch', () => {
  it('removes every browser-event sink from the pinned Steel server build', () => {
    const result = patchSteelBuildSources({
      indexSource: `await server.register(steelBrowserPlugin, {\n        fileStorage: {\n            maxSizePerSession: 100 * MB,\n        },\n    });`,
      browserPluginSource: `    else {\n        // Use in-memory storage for development\n        storage = new InMemoryStorage(1000);\n        await storage.initialize();\n        fastify.log.info("Using in-memory log storage");\n    }`,
    })

    expect(result.indexSource).toContain('enableConsoleLogging: false')
    expect(result.indexSource).toContain('enableLogsRoutes: false')
    expect(result.browserPluginSource).toContain('storage = null;')
    expect(result.browserPluginSource).not.toContain('InMemoryStorage(1000)')
  })
})
