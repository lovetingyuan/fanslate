export type TranslationContentFormat = 'plain' | 'html'

/**
 * Carries the user's selected content in both plain-text and sanitized HTML
 * form so provider adapters can choose the richest safe representation.
 */
export interface TranslationSourcePayload {
  plainText: string
  sanitizedHtml?: string
  format: TranslationContentFormat
}

/**
 * Optional rich-text result metadata used by the in-page dialog while keeping
 * plain-text consumers backward compatible.
 */
export interface TranslationRichTextResult {
  contentFormat?: TranslationContentFormat
  translationHtml?: string
}

export interface TranslationProviderResult extends TranslationRichTextResult {
  contentFormat: TranslationContentFormat
  translation: string
}

const HTML_TAG_PATTERN = /<[^>]+>/u
const HTML_ENTITY_PATTERN = /&(#\d+|#x[a-f\d]+|[a-z]+);/giu
const HTML_TAGS_WITH_BREAKS = /<(?:\/?(?:p|div|section|article|header|footer|aside|main|figure|figcaption|blockquote|li|ul|ol|h[1-6])\b[^>]*|br\s*\/?)>/giu

const decodeNamedHtmlEntity = (entityName: string): string => {
  const normalized = entityName.toLowerCase()

  switch (normalized) {
    case 'amp':
      return '&'
    case 'lt':
      return '<'
    case 'gt':
      return '>'
    case 'quot':
      return '"'
    case 'apos':
    case '#39':
      return "'"
    case 'nbsp':
      return ' '
    default:
      return `&${entityName};`
  }
}

/**
 * Provides a shared HTML-to-text fallback that works in both the extension and
 * Node-based tests, where DOMParser is not always available.
 */
export const stripHtmlToPlainText = (value: string): string => {
  return value
    .replace(HTML_TAGS_WITH_BREAKS, '\n')
    .replace(/<[^>]+>/gu, '')
    .replace(HTML_ENTITY_PATTERN, (match, entity) => {
      if (entity.startsWith('#x') || entity.startsWith('#X')) {
        const codePoint = Number.parseInt(entity.slice(2), 16)
        return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint)
      }

      if (entity.startsWith('#')) {
        const codePoint = Number.parseInt(entity.slice(1), 10)
        return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint)
      }

      return decodeNamedHtmlEntity(entity)
    })
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

export const hasMeaningfulHtml = (value: string | undefined): boolean =>
  typeof value === 'string' && HTML_TAG_PATTERN.test(value)

export const createPlainTextSource = (plainText: string): TranslationSourcePayload => ({
  plainText,
  format: 'plain',
})

export const createHtmlSource = (
  plainText: string,
  sanitizedHtml: string,
): TranslationSourcePayload => ({
  plainText,
  sanitizedHtml,
  format: hasMeaningfulHtml(sanitizedHtml) ? 'html' : 'plain',
})

export const normalizeTranslationSourcePayload = (
  value: unknown,
): TranslationSourcePayload | null => {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const candidate = value as Record<string, unknown>
  const plainText = typeof candidate.plainText === 'string' ? candidate.plainText.trim() : ''
  const format = candidate.format === 'html' ? 'html' : 'plain'
  const sanitizedHtml =
    typeof candidate.sanitizedHtml === 'string' ? candidate.sanitizedHtml.trim() : undefined

  if (!plainText) {
    return null
  }

  if (format === 'html' && sanitizedHtml && hasMeaningfulHtml(sanitizedHtml)) {
    return {
      plainText,
      sanitizedHtml,
      format: 'html',
    }
  }

  return {
    plainText,
    format: 'plain',
  }
}

export const buildTranslationSourceKey = (source: TranslationSourcePayload): string => {
  if (source.format === 'html' && source.sanitizedHtml) {
    const p = source.plainText.length
    const h = source.sanitizedHtml.length
    return `html:${p}:${source.plainText}:${h}:${source.sanitizedHtml}`
  }
  return `plain:${source.plainText.length}:${source.plainText}`
}

const normalizeComparableSelectionText = (value: string): string =>
  value.replace(/\s+/gu, ' ').trim()

export const chooseSelectionSource = ({
  cachedSource,
  fallbackText,
  liveSource,
}: {
  cachedSource: TranslationSourcePayload | null
  fallbackText: string
  liveSource: TranslationSourcePayload | null
}): TranslationSourcePayload => {
  const normalizedFallbackText = normalizeComparableSelectionText(fallbackText)

  if (liveSource && normalizeComparableSelectionText(liveSource.plainText) === normalizedFallbackText) {
    return liveSource
  }

  if (
    cachedSource &&
    normalizeComparableSelectionText(cachedSource.plainText) === normalizedFallbackText
  ) {
    return cachedSource
  }

  return createPlainTextSource(normalizedFallbackText)
}

export const resolveSourceRequestBody = (source: TranslationSourcePayload | string): string => {
  if (typeof source === 'string') {
    return source
  }

  return source.format === 'html' && source.sanitizedHtml ? source.sanitizedHtml : source.plainText
}

export const resolveSourcePlainText = (source: TranslationSourcePayload | string): string =>
  typeof source === 'string' ? source : source.plainText
