import { describe, expect, it } from 'vitest'

import {
  buildBrowserLikeHeaders,
  type TranslationProviderRuntimeConfig,
} from '../utils/translationProviders'

const runtimeConfig: TranslationProviderRuntimeConfig = {
  defaultHeaders: {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    priority: 'u=1, i',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site',
  },
  getDeepLApiKey: async () => null,
  getGoogleApiKey: async () => '',
  getMicrosoftToken: async () => '',
  getOpenRouterApiKey: async () => null,
  getOpenRouterModel: async () => 'openrouter/free',
  logger: {
    error: () => undefined,
    log: () => undefined,
  },
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
}

describe('buildBrowserLikeHeaders', () => {
  it('merges browser defaults with request-specific headers', () => {
    const headers = buildBrowserLikeHeaders(runtimeConfig, {
      'content-type': 'application/json',
      origin: 'https://example.com',
      referer: 'https://example.com/page',
    })

    expect(headers['user-agent']).toContain('Mozilla/5.0')
    expect(headers.accept).toBe('application/json, text/plain, */*')
    expect(headers['sec-fetch-mode']).toBe('cors')
    expect(headers.origin).toBe('https://example.com')
    expect(headers.referer).toBe('https://example.com/page')
    expect(headers['content-type']).toBe('application/json')
  })
})
