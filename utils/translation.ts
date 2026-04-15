import { getApiKey } from './keyResolver'
import { logger } from './logger'
import {
  resolveSourcePlainText,
  type TranslationProviderResult,
  type TranslationRichTextResult,
  type TranslationSourcePayload,
} from './richText'
import {
  createTranslationProviders,
  type TranslationProviderRuntimeConfig,
} from './translationProviders'

export const TRANSLATION_SERVICE_IDS = [
  'google',
  'microsoft',
  'deepl',
  'openrouter',
] as const

export type TranslationServiceId = (typeof TRANSLATION_SERVICE_IDS)[number]
export type TranslationDirection = 'zh' | 'en'
export type TranslationResultStatus = 'success' | 'error'
export type TranslationHistoryItem = string

export interface TranslationServiceOption {
  id: TranslationServiceId
  label: string
}

export interface TranslationResultItem {
  service: TranslationServiceId
  serviceLabel: string
  status: TranslationResultStatus
  translation: string
  error: string
  direction: TranslationDirection
}
export interface TranslationResultItem extends TranslationRichTextResult {}

export interface TranslationBatchResult {
  results: TranslationResultItem[]
  direction: TranslationDirection
}

/**
 * Stores translation results by service so UI layers can incrementally merge,
 * filter, and re-order cards without re-requesting finished providers.
 */
export type TranslationResultsByService = Partial<
  Record<TranslationServiceId, TranslationResultItem>
>

export interface TranslateWithServicesOptions {
  signal?: AbortSignal
}

/**
 * Bundles the persisted provider visibility and selection state so popup and
 * content-script UIs can stay consistent after migrations or settings changes.
 */
export interface TranslationServicePreferences {
  selectedServices: TranslationServiceId[]
  hiddenServices: TranslationServiceId[]
  visibleServiceOptions: TranslationServiceOption[]
}

export type TranslatorFunction = (
  source: string | TranslationSourcePayload,
  targetLang: TranslationDirection,
  signal?: AbortSignal,
) => Promise<TranslationProviderResult>

const DEFAULT_SELECTED_SERVICES: TranslationServiceId[] = ['google']
const DEFAULT_HIDDEN_SERVICES: TranslationServiceId[] = []
const EXPIRATION_BUFFER_MS = 1000
const SELECTED_SERVICES_STORAGE_KEY = 'selectedServices'
const LEGACY_SELECTED_SERVICE_STORAGE_KEY = 'selectedService'
const HIDDEN_SERVICES_STORAGE_KEY = 'hiddenServices'
const TRANSLATION_HISTORY_STORAGE_KEY = 'translationHistory'
const MAX_TRANSLATION_HISTORY_ITEMS = 5

export const TRANSLATION_SERVICE_OPTIONS: TranslationServiceOption[] = [
  { id: 'google', label: 'Google' },
  { id: 'microsoft', label: 'Microsoft' },
  { id: 'deepl', label: 'DeepL' },
  { id: 'openrouter', label: 'OpenRouter' },
]

const TRANSLATION_SERVICE_LABELS: Record<TranslationServiceId, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
  deepl: 'DeepL',
  openrouter: 'OpenRouter',
}

let msTokenCache: { token: string; expiresAt: number } | null = null

export const isTranslationServiceId = (value: unknown): value is TranslationServiceId =>
  typeof value === 'string' && TRANSLATION_SERVICE_IDS.includes(value as TranslationServiceId)

const normalizeServiceIds = (value: unknown): TranslationServiceId[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.reduce<TranslationServiceId[]>((services, item) => {
    if (isTranslationServiceId(item) && !services.includes(item)) {
      services.push(item)
    }
    return services
  }, [])
}

/**
 * Popup 历史记录只保存原文字符串，因此在写入前统一做 trim、去空、去重和数量裁剪，
 * 保证 UI 层读取到的始终是可直接展示的最近记录列表。
 */
const normalizeTranslationHistory = (value: unknown): TranslationHistoryItem[] => {
  if (!Array.isArray(value)) {
    return []
  }

  const items: TranslationHistoryItem[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      continue
    }

    const normalizedItem = item.trim()
    if (!normalizedItem || items.includes(normalizedItem)) {
      continue
    }

    items.push(normalizedItem)

    if (items.length >= MAX_TRANSLATION_HISTORY_ITEMS) {
      break
    }
  }

  return items
}

const areSameServiceLists = (
  left: TranslationServiceId[],
  right: TranslationServiceId[],
): boolean =>
  left.length === right.length && left.every((service, index) => service === right[index])

const getVisibleServiceIds = (hiddenServices: TranslationServiceId[]): TranslationServiceId[] => {
  return TRANSLATION_SERVICE_IDS.filter(service => !hiddenServices.includes(service))
}

const filterHiddenServices = (
  services: TranslationServiceId[],
  hiddenServices: TranslationServiceId[],
): TranslationServiceId[] => {
  return services.filter(service => !hiddenServices.includes(service))
}

const resolveFallbackSelectedServices = (
  hiddenServices: TranslationServiceId[],
): TranslationServiceId[] => {
  const visibleDefaultServices = filterHiddenServices(DEFAULT_SELECTED_SERVICES, hiddenServices)
  if (visibleDefaultServices.length > 0) {
    return visibleDefaultServices
  }

  const firstVisibleService = getVisibleServiceIds(hiddenServices)[0]
  return firstVisibleService ? [firstVisibleService] : []
}

const normalizeSelectedServices = (
  value: unknown,
  hiddenServices: TranslationServiceId[],
): TranslationServiceId[] => {
  const visibleSelectedServices = filterHiddenServices(normalizeServiceIds(value), hiddenServices)
  return visibleSelectedServices.length > 0
    ? visibleSelectedServices
    : resolveFallbackSelectedServices(hiddenServices)
}

const normalizeHiddenServices = (value: unknown): TranslationServiceId[] => {
  return normalizeServiceIds(value)
}

export const getVisibleTranslationServiceOptions = (
  hiddenServices: TranslationServiceId[],
): TranslationServiceOption[] => {
  return TRANSLATION_SERVICE_OPTIONS.filter(option => !hiddenServices.includes(option.id))
}

const loadServicePreferencesFromStorage = async (): Promise<TranslationServicePreferences> => {
  const result = await browser.storage.local.get([
    SELECTED_SERVICES_STORAGE_KEY,
    LEGACY_SELECTED_SERVICE_STORAGE_KEY,
    HIDDEN_SERVICES_STORAGE_KEY,
  ])

  const hasStoredHiddenServices = HIDDEN_SERVICES_STORAGE_KEY in result
  const hiddenServices = hasStoredHiddenServices
    ? normalizeHiddenServices(result.hiddenServices)
    : DEFAULT_HIDDEN_SERVICES

  const storedSelectedServices =
    SELECTED_SERVICES_STORAGE_KEY in result
      ? result.selectedServices
      : [result[LEGACY_SELECTED_SERVICE_STORAGE_KEY]]

  const selectedServices = normalizeSelectedServices(storedSelectedServices, hiddenServices)
  const visibleServiceOptions = getVisibleTranslationServiceOptions(hiddenServices)

  const storageUpdates: Record<string, TranslationServiceId[]> = {}
  if (
    !hasStoredHiddenServices ||
    !areSameServiceLists(hiddenServices, normalizeHiddenServices(result.hiddenServices))
  ) {
    storageUpdates[HIDDEN_SERVICES_STORAGE_KEY] = hiddenServices
  }

  if (
    !(SELECTED_SERVICES_STORAGE_KEY in result) ||
    !areSameServiceLists(selectedServices, normalizeServiceIds(result.selectedServices))
  ) {
    storageUpdates[SELECTED_SERVICES_STORAGE_KEY] = selectedServices
  }

  if (Object.keys(storageUpdates).length > 0) {
    await browser.storage.local.set(storageUpdates)
  }

  if (LEGACY_SELECTED_SERVICE_STORAGE_KEY in result) {
    await browser.storage.local.remove(LEGACY_SELECTED_SERVICE_STORAGE_KEY)
  }

  return {
    selectedServices,
    hiddenServices,
    visibleServiceOptions,
  }
}

const createAbortError = (): DOMException => {
  return new DOMException('Translation aborted', 'AbortError')
}

export const buildTranslationSessionKey = (text: string, direction: TranslationDirection): string =>
  `${direction}::${text}`

/**
 * Centralizes abort detection because browser messaging and fetch can surface
 * slightly different error shapes when a translation batch is cancelled.
 */
export const isAbortError = (error: unknown): boolean => {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return (
      error.name === 'AbortError' ||
      message.includes('aborterror') ||
      message.includes('aborted') ||
      message.includes('signal is aborted')
    )
  }

  return false
}

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return fallback
}

const parseMSToken = (token: string): number => {
  try {
    const payload = token.split('.')[1]
    const decoded = JSON.parse(atob(payload)) as { exp?: number }
    return decoded.exp ?? 0
  } catch (err) {
    logger.error('parseMSToken error:', err)
    return 0
  }
}

const getMicrosoftToken = async (): Promise<string> => {
  const now = Date.now()

  if (msTokenCache && msTokenCache.expiresAt > now + EXPIRATION_BUFFER_MS) {
    logger.log('使用缓存的Microsoft token')
    return msTokenCache.token
  }

  const storageResult = await browser.storage.local.get('msAuthToken')
  const storageToken = storageResult.msAuthToken as string | undefined

  if (storageToken) {
    const storageExp = parseMSToken(storageToken)
    const storageExpiresAt = storageExp * 1000

    if (storageExpiresAt > now + EXPIRATION_BUFFER_MS) {
      logger.log('使用storage缓存的Microsoft token')
      msTokenCache = { token: storageToken, expiresAt: storageExpiresAt }
      return storageToken
    }
  }

  logger.log('获取新的Microsoft token')
  const response = await fetch('https://edge.microsoft.com/translate/auth')

  if (!response.ok) {
    throw new Error(`Microsoft token请求失败: ${response.status}`)
  }

  const token = await response.text()
  const exp = parseMSToken(token)
  const expiresAt = exp * 1000

  await browser.storage.local.set({ msAuthToken: token })
  msTokenCache = { token, expiresAt }

  logger.log('Microsoft token获取成功，过期时间:', new Date(expiresAt))
  return token
}

const getStorageString = async (key: string): Promise<string | null> => {
  const result = await browser.storage.local.get([key])
  const value = result[key]

  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/**
 * Keeps the provider request logic shared with Node smoke tests while the
 * extension still resolves secrets from browser storage and its bundled key.
 */
const extensionRuntimeConfig: TranslationProviderRuntimeConfig = {
  defaultHeaders: {
    accept: 'application/json, text/plain, */*',
    'accept-language':
      navigator.languages?.join(',') || navigator.language || 'zh-CN,zh;q=0.9,en;q=0.8',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
  },
  getDeepLApiKey: () => getStorageString('deeplApiKey'),
  getGoogleApiKey: async () => getApiKey(),
  getMicrosoftToken: signal => {
    if (signal?.aborted) {
      throw createAbortError()
    }

    return getMicrosoftToken()
  },
  getOpenRouterApiKey: () => getStorageString('openRouterApiKey'),
  getOpenRouterModel: async () => (await getStorageString('openRouterModelId')) ?? 'openrouter/free',
  logger,
  userAgent: navigator.userAgent,
}

const translatorMap = createTranslationProviders(extensionRuntimeConfig)

export const getServiceLabel = (service: TranslationServiceId): string => {
  return TRANSLATION_SERVICE_LABELS[service]
}

export const mapResultsByService = (
  results: TranslationResultItem[],
): TranslationResultsByService => {
  return results.reduce<TranslationResultsByService>((accumulator, result) => {
    accumulator[result.service] = result
    return accumulator
  }, {})
}

/**
 * Preserves the user's selected provider order so restored cached cards and new
 * results appear in a stable, predictable sequence.
 */
export const orderResultsByServices = (
  resultsByService: TranslationResultsByService,
  services: TranslationServiceId[],
): TranslationResultItem[] => {
  return services.flatMap(service => {
    const result = resultsByService[service]
    return result ? [result] : []
  })
}

/**
 * Keeps the service selector label compact while still reflecting the user's
 * saved service order across popup and in-page dialog.
 */
export const getSelectedServicesSummary = (services: TranslationServiceId[]): string => {
  if (services.length === 0) {
    return '未选择服务'
  }

  const firstLabel = getServiceLabel(services[0])
  if (services.length === 1) {
    return firstLabel
  }

  return `${firstLabel} +${services.length - 1}`
}

/**
 * Reads the user's enabled translation services and transparently migrates the
 * legacy single-select storage key on first access.
 */
export const getSelectedServices = async (): Promise<TranslationServiceId[]> => {
  const preferences = await loadServicePreferencesFromStorage()
  return preferences.selectedServices
}

/**
 * Exposes the normalized provider visibility state so all UIs can render the
 * same visible provider list and heal persisted selections automatically.
 */
export const getTranslationServicePreferences = async (): Promise<TranslationServicePreferences> =>
  loadServicePreferencesFromStorage()

/**
 * Reads the persisted hidden-provider list and normalizes it against the
 * currently supported providers so stale ids disappear automatically.
 */
export const getHiddenServices = async (): Promise<TranslationServiceId[]> => {
  const preferences = await loadServicePreferencesFromStorage()
  return preferences.hiddenServices
}

/**
 * Persists the exact service order chosen in the UI so both popup and page
 * dialog can render results in the same predictable order.
 */
export const setSelectedServices = async (
  services: TranslationServiceId[],
): Promise<TranslationServiceId[]> => {
  const hiddenServices = await getHiddenServices()
  const normalizedServices = normalizeSelectedServices(services, hiddenServices)
  await browser.storage.local.set({ [SELECTED_SERVICES_STORAGE_KEY]: normalizedServices })
  await browser.storage.local.remove(LEGACY_SELECTED_SERVICE_STORAGE_KEY)
  return normalizedServices
}

/**
 * Persists provider visibility rules and immediately revalidates the selected
 * provider order so hidden services cannot remain active in later requests.
 */
export const setHiddenServices = async (
  hiddenServices: TranslationServiceId[],
): Promise<TranslationServicePreferences> => {
  const normalizedHiddenServices = normalizeHiddenServices(hiddenServices)
  const visibleServiceOptions = getVisibleTranslationServiceOptions(normalizedHiddenServices)

  if (visibleServiceOptions.length === 0) {
    throw new Error('至少保留一个可见翻译服务')
  }

  const result = await browser.storage.local.get([
    SELECTED_SERVICES_STORAGE_KEY,
    LEGACY_SELECTED_SERVICE_STORAGE_KEY,
  ])
  const storedSelectedServices =
    SELECTED_SERVICES_STORAGE_KEY in result
      ? result.selectedServices
      : [result[LEGACY_SELECTED_SERVICE_STORAGE_KEY]]

  const selectedServices = normalizeSelectedServices(
    storedSelectedServices,
    normalizedHiddenServices,
  )

  await browser.storage.local.set({
    [HIDDEN_SERVICES_STORAGE_KEY]: normalizedHiddenServices,
    [SELECTED_SERVICES_STORAGE_KEY]: selectedServices,
  })
  await browser.storage.local.remove(LEGACY_SELECTED_SERVICE_STORAGE_KEY)

  return {
    selectedServices,
    hiddenServices: normalizedHiddenServices,
    visibleServiceOptions,
  }
}

/**
 * 读取 Popup 翻译历史，并在发现旧数据不符合约束时自动修正存储，
 * 避免 UI 侧为脏数据重复兜底。
 */
export const getTranslationHistory = async (): Promise<TranslationHistoryItem[]> => {
  const result = await browser.storage.local.get([TRANSLATION_HISTORY_STORAGE_KEY])
  const normalizedHistory = normalizeTranslationHistory(result[TRANSLATION_HISTORY_STORAGE_KEY])

  if (
    !Array.isArray(result[TRANSLATION_HISTORY_STORAGE_KEY]) ||
    result[TRANSLATION_HISTORY_STORAGE_KEY].length !== normalizedHistory.length ||
    result[TRANSLATION_HISTORY_STORAGE_KEY].some?.(
      (item: unknown, index: number) => item !== normalizedHistory[index],
    )
  ) {
    await browser.storage.local.set({ [TRANSLATION_HISTORY_STORAGE_KEY]: normalizedHistory })
  }

  return normalizedHistory
}

/**
 * 新历史写入头部；若文本已存在则提升到第一位，并保持最多五条。
 */
export const addTranslationHistoryItem = async (
  text: string,
): Promise<TranslationHistoryItem[]> => {
  const normalizedText = text.trim()
  if (!normalizedText) {
    return getTranslationHistory()
  }

  const currentHistory = await getTranslationHistory()
  const nextHistory = [
    normalizedText,
    ...currentHistory.filter(item => item !== normalizedText),
  ].slice(0, MAX_TRANSLATION_HISTORY_ITEMS)

  await browser.storage.local.set({ [TRANSLATION_HISTORY_STORAGE_KEY]: nextHistory })
  return nextHistory
}

export const detectDirection = (text: string): TranslationDirection => {
  const cnCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const enCount = (text.match(/[a-zA-Z]/g) || []).length

  return enCount > cnCount * 3 ? 'zh' : 'en'
}

/**
 * Encapsulates a single provider request so callers can cache or retry each
 * service independently while keeping the existing per-provider error payload.
 */
export const translateWithService = async (
  source: string | TranslationSourcePayload,
  service: TranslationServiceId,
  targetLang?: TranslationDirection,
  signal?: AbortSignal,
): Promise<TranslationResultItem> => {
  const finalDirection = targetLang || detectDirection(resolveSourcePlainText(source))
  const translator = translatorMap[service]

  try {
    const translationResult = await translator(source, finalDirection, signal)

    if (signal?.aborted) {
      throw createAbortError()
    }

    return {
      service,
      serviceLabel: getServiceLabel(service),
      status: 'success',
      translation: translationResult.translation,
      translationHtml: translationResult.translationHtml,
      contentFormat: translationResult.contentFormat,
      error: '',
      direction: finalDirection,
    }
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      throw error
    }

    return {
      service,
      serviceLabel: getServiceLabel(service),
      status: 'error',
      translation: '',
      error: getErrorMessage(error, `${getServiceLabel(service)} 翻译失败`),
      direction: finalDirection,
    }
  }
}

/**
 * Executes all requested translators in parallel. Callers provide their own
 * AbortSignal so popup and in-page dialog can cancel only the requests that
 * belong to the active translation session.
 */
export const translateWithServices = async (
  source: string | TranslationSourcePayload,
  services?: TranslationServiceId[],
  targetLang?: TranslationDirection,
  options?: TranslateWithServicesOptions,
): Promise<TranslationBatchResult> => {
  const finalDirection = targetLang || detectDirection(resolveSourcePlainText(source))
  const signal = options?.signal
  const hiddenServices = await getHiddenServices()
  const selectedServices = services
    ? filterHiddenServices(normalizeServiceIds(services), hiddenServices)
    : await getSelectedServices()

  if (selectedServices.length === 0) {
    throw new Error('至少选择一个翻译服务')
  }

  const results = await Promise.all(
    selectedServices.map(service => translateWithService(source, service, finalDirection, signal)),
  )

  if (signal?.aborted) {
    throw createAbortError()
  }

  return { results, direction: finalDirection }
}

export const translateText = async (
  text: string,
  service?: TranslationServiceId,
  targetLang?: TranslationDirection,
): Promise<{ translation: string; direction: TranslationDirection }> => {
  const selectedServices = service ? [service] : await getSelectedServices()
  const firstService = selectedServices[0]

  if (!firstService) {
    throw new Error('至少选择一个翻译服务')
  }

  const batchResult = await translateWithServices(text, [firstService], targetLang)
  const firstResult = batchResult.results[0]

  if (!firstResult) {
    throw new Error('未返回翻译结果')
  }

  if (firstResult.status === 'error') {
    throw new Error(firstResult.error || '翻译失败')
  }

  return {
    translation: firstResult.translation,
    direction: batchResult.direction,
  }
}
