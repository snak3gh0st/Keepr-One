import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      'server-only': path.resolve(__dirname, 'tests/shims/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // `.worktrees/` holds full checkouts of other branches. Without this, every
    // run also executed their copies of these tests — inflating the count by
    // roughly half and failing on code that is not in this branch at all.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.worktrees/**'],
  },
})
