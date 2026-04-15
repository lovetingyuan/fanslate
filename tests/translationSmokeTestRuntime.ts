import type { TranslationServiceId } from '../utils/translation'
import {
  createTranslationProviders,
  type TranslationProviderRuntimeConfig,
} from '../utils/translationProviders'

interface JwtPayload {
  exp?: number
}

const DEFAULT_OPENROUTER_MODEL = 'openrouter/free'
const EXPIRATION_BUFFER_MS = 1_000
const MICROSOFT_TOKEN_URL = 'https://edge.microsoft.com/translate/auth'
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'

let microsoftTokenCache: { expiresAt: number; token: string } | null = null
let smokeTestQueue: Promise<void> = Promise.resolve()

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms)
  })

const isRetryableSmokeTestError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false
  }

  return (
    error.message.includes('429') ||
    error.message.includes('408') ||
    error.message.includes('500') ||
    error.message.includes('502') ||
    error.message.includes('503') ||
    error.message.includes('504')
  )
}

const runSmokeTestWithRetries = async (
  service: TranslationServiceId,
  maxAttempts = 3,
): Promise<string> => {
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await translationProviders[service]('apple', 'zh')
    } catch (error) {
      lastError = error

      if (!isRetryableSmokeTestError(error) || attempt === maxAttempts) {
        throw error
      }

      const retryDelayMs =
        error instanceof Error && error.message.includes('429') ? 15_000 * attempt : 1_000 * attempt
      await sleep(retryDelayMs)
    }
  }

  throw lastError
}

const testLogger = {
  error: (...args: unknown[]) => {
    console.error(...args)
  },
  log: (...args: unknown[]) => {
    console.log(...args)
  },
}

const requireEnv = (name: string): string => {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`${name} is required to run translation smoke tests`)
  }

  return value
}

/**
 * Microsoft returns a JWT token, so the smoke tests decode only the `exp`
 * claim and keep a short in-memory cache to avoid fetching a new token per case.
 */
const parseJwtExpiration = (token: string): number => {
  try {
    const encodedPayload = token.split('.')[1]
    if (!encodedPayload) {
      return 0
    }

    const normalizedPayload = encodedPayload.replace(/-/g, '+').replace(/_/g, '/')
    const paddingLength = (4 - (normalizedPayload.length % 4)) % 4
    const paddedPayload = normalizedPayload + '='.repeat(paddingLength)
    const payload = JSON.parse(Buffer.from(paddedPayload, 'base64').toString('utf8')) as JwtPayload

    return payload.exp ?? 0
  } catch {
    return 0
  }
}

const getMicrosoftTokenForTests = async (signal?: AbortSignal): Promise<string> => {
  const now = Date.now()

  if (microsoftTokenCache && microsoftTokenCache.expiresAt > now + EXPIRATION_BUFFER_MS) {
    return microsoftTokenCache.token
  }

  const response = await fetch(MICROSOFT_TOKEN_URL, { signal })

  if (!response.ok) {
    throw new Error(`Microsoft token请求失败: ${response.status}`)
  }

  const token = await response.text()
  const expiresAt = parseJwtExpiration(token) * 1000
  microsoftTokenCache = { token, expiresAt }

  return token
}

const nodeRuntimeConfig: TranslationProviderRuntimeConfig = {
  defaultHeaders: {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-US;q=0.7',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    priority: 'u=1, i',
  },
  getDeepLApiKey: async () => requireEnv('DEEPL_API_KEY'),
  getGoogleApiKey: async () => requireEnv('GOOGLE_TRANSLATE_API_KEY'),
  getMicrosoftToken: getMicrosoftTokenForTests,
  getOpenRouterApiKey: async () => requireEnv('OPENROUTER_API_KEY'),
  getOpenRouterModel: async () => DEFAULT_OPENROUTER_MODEL,
  logger: testLogger,
  userAgent: BROWSER_USER_AGENT,
}

const translationProviders = createTranslationProviders(nodeRuntimeConfig)

export const runTranslationSmokeTest = async (
  service: TranslationServiceId,
): Promise<string> => {
  const translationPromise = smokeTestQueue.then(() => runSmokeTestWithRetries(service))
  smokeTestQueue = translationPromise.then(
    () => undefined,
    () => undefined,
  )
  const translation = await translationPromise

  return translation.trim()
}
