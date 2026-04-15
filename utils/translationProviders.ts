import type {
  TranslationServiceId,
  TranslatorFunction,
} from './translation'
import {
  hasMeaningfulHtml,
  resolveSourcePlainText,
  resolveSourceRequestBody,
  stripHtmlToPlainText,
  type TranslationProviderResult,
  type TranslationSourcePayload,
} from './richText'

interface OpenRouterMessage {
  content?: string
}

interface OpenRouterChoice {
  message?: OpenRouterMessage
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[]
}

interface MicrosoftTranslation {
  text?: string
}

interface MicrosoftTranslationResponseItem {
  translations?: MicrosoftTranslation[]
}

/**
 * Captures the minimal DeepL response shape used by the extension so malformed
 * API payloads surface as explicit provider errors instead of silent failures.
 */
interface DeepLTranslation {
  text?: string
}

interface DeepLTranslationResponse {
  translations?: DeepLTranslation[]
}

interface TranslationProviderLogger {
  error: (...args: unknown[]) => void
  log: (...args: unknown[]) => void
}

export type RequestHeaders = Record<string, string>

export interface TranslationProviderRuntimeConfig {
  defaultHeaders: RequestHeaders
  getDeepLApiKey: () => Promise<string | null>
  getGoogleApiKey: () => Promise<string>
  getMicrosoftToken: (signal?: AbortSignal) => Promise<string>
  getOpenRouterApiKey: () => Promise<string | null>
  getOpenRouterModel: () => Promise<string>
  logger: TranslationProviderLogger
  userAgent: string
}

const DEFAULT_OPENROUTER_MODEL = 'openrouter/free'
const HTML_TOKEN_PATTERN = /(<[^>]+>)/u

interface HtmlTextSegment {
  coreText: string
  leadingWhitespace: string
  tokenIndex: number
  trailingWhitespace: string
}

const readResponseTextSafely = async (response: Response): Promise<string> => {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

/**
 * Centralizes the browser-flavored request profile so providers share one
 * consistent baseline instead of each call drifting into a script-like shape.
 */
export const buildBrowserLikeHeaders = (
  runtimeConfig: TranslationProviderRuntimeConfig,
  overrides: RequestHeaders,
): RequestHeaders => {
  return {
    ...runtimeConfig.defaultHeaders,
    'user-agent': runtimeConfig.userAgent,
    ...overrides,
  }
}

/**
 * Builds provider functions around an injected runtime so the same request
 * logic can run inside the extension and in Node-based smoke tests.
 */
export const createTranslationProviders = (
  runtimeConfig: TranslationProviderRuntimeConfig,
): Record<TranslationServiceId, TranslatorFunction> => {
  const buildPlainResult = (translation: string): TranslationProviderResult => ({
    translation,
    contentFormat: 'plain',
  })

  const buildHtmlResult = (translationHtml: string): TranslationProviderResult => ({
    translation: stripHtmlToPlainText(translationHtml),
    translationHtml,
    contentFormat: 'html',
  })

  const resolveRichHtmlSource = (source: string | TranslationSourcePayload): string | null =>
    typeof source !== 'string' && source.format === 'html' && source.sanitizedHtml
      ? source.sanitizedHtml
      : null

  const collectHtmlTextSegments = (html: string): { segments: HtmlTextSegment[]; tokens: string[] } => {
    const tokens = html.split(HTML_TOKEN_PATTERN)
    const segments = tokens.reduce<HtmlTextSegment[]>((accumulator, token, tokenIndex) => {
      if (!token || token.startsWith('<')) {
        return accumulator
      }

      const trimmed = token.trim()
      if (!trimmed) {
        return accumulator
      }

      const leadingWhitespaceLength = token.length - token.trimStart().length
      const trailingWhitespaceLength = token.length - token.trimEnd().length

      accumulator.push({
        tokenIndex,
        coreText: trimmed,
        leadingWhitespace: token.slice(0, leadingWhitespaceLength),
        trailingWhitespace:
          trailingWhitespaceLength > 0 ? token.slice(token.length - trailingWhitespaceLength) : '',
      })

      return accumulator
    }, [])

    return { tokens, segments }
  }

  const reconstructHtmlTranslation = async (
    html: string,
    translatePlainText: (text: string) => Promise<string>,
  ): Promise<TranslationProviderResult> => {
    const { tokens, segments } = collectHtmlTextSegments(html)

    if (segments.length === 0) {
      return buildHtmlResult(html)
    }

    const translatedSegments = await Promise.all(
      segments.map(async segment => ({
        ...segment,
        translation: await translatePlainText(segment.coreText),
      })),
    )

    translatedSegments.forEach(segment => {
      tokens[segment.tokenIndex] = `${segment.leadingWhitespace}${segment.translation}${segment.trailingWhitespace}`
    })

    return buildHtmlResult(tokens.join(''))
  }

  const requestGoogleTranslation = async (
    text: string,
    targetLang: string,
    signal?: AbortSignal,
  ): Promise<string> => {
    const url = 'https://translate-pa.googleapis.com/v1/translateHtml'

    runtimeConfig.logger.log('正在请求Google翻译API:', url)

    const response = await fetch(url, {
      method: 'POST',
      headers: buildBrowserLikeHeaders(runtimeConfig, {
        'Content-Type': 'application/json+protobuf',
        'X-Goog-API-Key': await runtimeConfig.getGoogleApiKey(),
        accept: '*/*',
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'en,zh-CN;q=0.9,zh;q=0.8,ja;q=0.7,en-US;q=0.6',
        origin: 'https://translate.google.com',
        referer: 'https://translate.google.com/',
      }),
      body: JSON.stringify([[[text], 'auto', targetLang], 'wt_lib']),
      signal,
    })

    runtimeConfig.logger.log('GoogleHtml翻译API响应状态:', response.status, response.statusText)

    if (!response.ok) {
      throw new Error(`GoogleHtml翻译请求失败: ${response.status}`)
    }

    const data = (await response.json()) as unknown
    runtimeConfig.logger.log('GoogleHtml翻译API返回数据:', JSON.stringify(data, null, 2))

    if (Array.isArray(data) && data.length > 0) {
      const firstItem = data[0]

      if (typeof firstItem === 'number') {
        const message = typeof data[1] === 'string' ? data[1] : '未知错误'
        throw new Error(`GoogleHtml翻译API错误 (${firstItem}): ${message}`)
      }

      if (Array.isArray(firstItem) && firstItem.length > 0 && typeof firstItem[0] === 'string') {
        return firstItem[0]
      }

      if (typeof firstItem === 'string') {
        return firstItem
      }
    }

    throw new Error('GoogleHtml翻译返回数据格式错误')
  }

  const translateWithGoogle: TranslatorFunction = async (source, targetLang, signal) => {
    const requestBody = resolveSourceRequestBody(source)
    const richHtmlSource = resolveRichHtmlSource(source)
    const translation = await requestGoogleTranslation(requestBody, targetLang, signal)

    if (richHtmlSource && hasMeaningfulHtml(translation)) {
      return buildHtmlResult(translation)
    }

    if (richHtmlSource) {
      return reconstructHtmlTranslation(richHtmlSource, text =>
        requestGoogleTranslation(text, targetLang, signal),
      )
    }

    return buildPlainResult(translation)
  }

  const translateWithMicrosoft: TranslatorFunction = async (source, targetLang, signal) => {
    const toLang = targetLang === 'zh' ? 'zh-Hans' : 'en'
    const richHtmlSource = resolveRichHtmlSource(source)
    const url = `https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&from=&to=${toLang}${richHtmlSource ? '&textType=html' : ''}`

    runtimeConfig.logger.log('正在请求Microsoft翻译API:', url)

    const token = await runtimeConfig.getMicrosoftToken(signal)

    const response = await fetch(url, {
      method: 'POST',
      headers: buildBrowserLikeHeaders(runtimeConfig, {
        accept: '*/*',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
        authorization: `Bearer ${token}`,
        'cache-control': 'no-cache',
        'content-type': 'application/json',
        origin: 'https://www.bing.com',
        pragma: 'no-cache',
        referer: 'https://www.bing.com/',
      }),
      body: JSON.stringify([{ Text: resolveSourceRequestBody(source) }]),
      signal,
    })

    runtimeConfig.logger.log('Microsoft翻译API响应状态:', response.status, response.statusText)

    if (!response.ok) {
      const errorText = await readResponseTextSafely(response)
      runtimeConfig.logger.error('Microsoft翻译API错误响应:', errorText)
      throw new Error(`Microsoft翻译请求失败: ${response.status}`)
    }

    const data = (await response.json()) as MicrosoftTranslationResponseItem[]
    runtimeConfig.logger.log('Microsoft翻译API返回数据:', data)

    const translation = data[0]?.translations?.[0]?.text
    if (typeof translation === 'string') {
      return richHtmlSource && hasMeaningfulHtml(translation)
        ? buildHtmlResult(translation)
        : buildPlainResult(richHtmlSource ? stripHtmlToPlainText(translation) : translation)
    }

    throw new Error('Microsoft翻译返回数据格式错误')
  }

  const translateWithDeepL: TranslatorFunction = async (source, targetLang, signal) => {
    const apiKey = await runtimeConfig.getDeepLApiKey()
    const richHtmlSource = resolveRichHtmlSource(source)

    if (!apiKey) {
      throw new Error('DeepL API Key 未配置，请先在设置中填写')
    }

    const deeplTargetLang = targetLang === 'zh' ? 'ZH' : 'EN'
    const url = 'https://api-free.deepl.com/v2/translate'

    runtimeConfig.logger.log('正在请求DeepL翻译API:', url, 'Target:', deeplTargetLang)

    const response = await fetch(url, {
      method: 'POST',
      headers: buildBrowserLikeHeaders(runtimeConfig, {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        origin: 'https://www.deepl.com',
        referer: 'https://www.deepl.com/translator',
      }),
      body: JSON.stringify({
        text: [resolveSourceRequestBody(source)],
        target_lang: deeplTargetLang,
        ...(richHtmlSource
          ? {
              tag_handling: 'html',
              tag_handling_version: 'v2',
              preserve_formatting: true,
            }
          : {}),
      }),
      signal,
    })

    runtimeConfig.logger.log('DeepL翻译API响应状态:', response.status, response.statusText)

    if (!response.ok) {
      const errorText = await readResponseTextSafely(response)
      runtimeConfig.logger.error('DeepL翻译API错误响应:', errorText)
      throw new Error(`DeepL请求失败: ${response.status}`)
    }

    const data = (await response.json()) as DeepLTranslationResponse
    runtimeConfig.logger.log('DeepL翻译API返回数据:', data)

    const translation = data.translations?.[0]?.text
    if (typeof translation === 'string') {
      return richHtmlSource && hasMeaningfulHtml(translation)
        ? buildHtmlResult(translation)
        : buildPlainResult(richHtmlSource ? stripHtmlToPlainText(translation) : translation)
    }

    throw new Error('DeepL翻译返回数据格式错误')
  }

  const translateWithOpenRouter: TranslatorFunction = async (source, targetLang, signal) => {
    const apiKey = await runtimeConfig.getOpenRouterApiKey()
    const model = (await runtimeConfig.getOpenRouterModel()) || DEFAULT_OPENROUTER_MODEL

    if (!apiKey) {
      throw new Error('OpenRouter API Key 未配置，请点击右上角设置')
    }

    const url = 'https://openrouter.ai/api/v1/chat/completions'
    const languageName = targetLang === 'zh' ? 'Chinese' : 'English'
    const systemPrompt = `Translate the content within <source_text> tags into ${languageName}.
Rules:
1. Ensure the translation is natural, fluent, and uses common native expressions.
2. Output ONLY the translation. No any extra content.
3. Try to preserve original formatting.`

    runtimeConfig.logger.log('正在请求OpenRouter翻译API:', url, 'Model:', model)

    const response = await fetch(url, {
      method: 'POST',
      headers: buildBrowserLikeHeaders(runtimeConfig, {
        Authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/wxt-dev/wxt',
        'X-Title': 'Translation Extension',
        origin: 'https://openrouter.ai',
        referer: 'https://openrouter.ai/',
      }),
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Translate the content inside <source_text> to ${languageName}:\n<source_text>\n${resolveSourcePlainText(source)}\n</source_text>`,
          },
        ],
      }),
      signal,
    })

    runtimeConfig.logger.log('OpenRouter API响应状态:', response.status, response.statusText)

    if (!response.ok) {
      const errorText = await readResponseTextSafely(response)
      runtimeConfig.logger.error('OpenRouter API错误响应:', errorText)
      throw new Error(`OpenRouter请求失败: ${response.status}`)
    }

    const data = (await response.json()) as OpenRouterResponse
    runtimeConfig.logger.log('OpenRouter API返回数据:', data)

    const content = data.choices?.[0]?.message?.content
    if (typeof content === 'string') {
      return buildPlainResult(content)
    }

    throw new Error('OpenRouter翻译返回数据格式错误')
  }

  return {
    google: translateWithGoogle,
    microsoft: translateWithMicrosoft,
    deepl: translateWithDeepL,
    openrouter: translateWithOpenRouter,
  }
}
