import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildBrowserLikeHeaders,
  createTranslationProviders,
  type TranslationProviderRuntimeConfig,
} from '../utils/translationProviders'
import { createHtmlSource, type TranslationSourcePayload } from '../utils/richText'
import { chooseSelectionSource } from '../utils/richText'

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

describe('createTranslationProviders', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reconstructs translated html when google rich-text translation loses markup', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_input, init) => {
        const parsedBody = JSON.parse(String(init?.body)) as [[[string], string, string], string]
        const requestText = parsedBody[0][0][0]

        if (requestText === '<p>Hello <strong>world</strong></p>') {
          return new Response(JSON.stringify([['你好 世界']]), { status: 200 })
        }

        if (requestText === 'Hello') {
          return new Response(JSON.stringify([['你好']]), { status: 200 })
        }

        if (requestText === 'world') {
          return new Response(JSON.stringify([['世界']]), { status: 200 })
        }

        throw new Error(`Unexpected request text: ${requestText}`)
      })

    vi.stubGlobal('fetch', fetchMock)

    const providers = createTranslationProviders(runtimeConfig)
    const result = await providers.google(
      createHtmlSource('Hello world', '<p>Hello <strong>world</strong></p>'),
      'zh',
    )

    expect(result.contentFormat).toBe('html')
    expect(result.translationHtml).toBe('<p>你好 <strong>世界</strong></p>')
    expect(result.translation).toBe('你好 世界')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('sends DeepL rich-text requests with html tag handling v2', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          translations: [{ text: '<p>你好 <strong>世界</strong></p>' }],
        }),
        { status: 200 },
      ),
    )

    vi.stubGlobal('fetch', fetchMock)

    const providers = createTranslationProviders({
      ...runtimeConfig,
      getDeepLApiKey: async () => 'test-deepl-key',
    })

    const result = await providers.deepl(
      createHtmlSource('Hello world', '<p>Hello <strong>world</strong></p>'),
      'zh',
    )

    const request = fetchMock.mock.calls[0]?.[1]
    const parsedBody = JSON.parse(String(request?.body)) as {
      preserve_formatting?: boolean
      tag_handling?: string
      tag_handling_version?: string
      text: string[]
    }

    expect(parsedBody.text).toEqual(['<p>Hello <strong>world</strong></p>'])
    expect(parsedBody.tag_handling).toBe('html')
    expect(parsedBody.tag_handling_version).toBe('v2')
    expect(parsedBody.preserve_formatting).toBe(true)
    expect(result.contentFormat).toBe('html')
    expect(result.translationHtml).toBe('<p>你好 <strong>世界</strong></p>')
  })
})

describe('chooseSelectionSource', () => {
  it('prefers the live rich-text selection over plain fallback text', () => {
    const richSource = createHtmlSource('Hello world', '<p>Hello <strong>world</strong></p>')

    const result = chooseSelectionSource({
      fallbackText: 'Hello world',
      liveSource: richSource,
      cachedSource: null,
    })

    expect(result).toEqual(richSource)
  })

  it('ignores a live selection payload when it does not match the clicked text', () => {
    const cachedSource: TranslationSourcePayload = createHtmlSource(
      'Hello world',
      '<p>Hello <strong>world</strong></p>',
    )
    const liveSource = createHtmlSource('Another text', '<p>Another <strong>text</strong></p>')

    const result = chooseSelectionSource({
      fallbackText: 'Hello world',
      liveSource,
      cachedSource,
    })

    expect(result).toEqual(cachedSource)
  })

  it('treats whitespace-normalized live rich text as the same clicked selection', () => {
    const richSource = createHtmlSource(
      'nodejs的事件循环\nNode.js 的事件循环是其异步非阻塞 I/O 模型的核心',
      '<h1>nodejs的事件循环</h1><p>Node.js 的事件循环是其异步非阻塞 I/O 模型的核心</p>',
    )

    const result = chooseSelectionSource({
      fallbackText: 'nodejs的事件循环 Node.js 的事件循环是其异步非阻塞 I/O 模型的核心',
      liveSource: richSource,
      cachedSource: null,
    })

    expect(result).toEqual(richSource)
  })
})
