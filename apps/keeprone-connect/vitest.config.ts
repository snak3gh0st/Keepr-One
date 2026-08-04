import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __KEEPR_ORIGIN__: JSON.stringify('http://localhost:3000'),
  },
  test: {
    environment: 'node',
  },
})
