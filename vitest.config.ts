import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { dedupe: ['react'] },
  test: { include: ['tests/**/*.spec.{ts,tsx}'] },
})
