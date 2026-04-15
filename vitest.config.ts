import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

const env = loadEnv('', process.cwd(), '')
for (const [key, value] of Object.entries(env)) {
  if (!(key in process.env)) {
    process.env[key] = value
  }
}

export default defineConfig({
  test: {
    environment: 'node',
  },
})
