import { css, html, render, svg } from 'lit'
import { unsafeSVG } from 'lit/directives/unsafe-svg.js'
import { browser } from 'wxt/browser'
import iconSvg from '../../assets/icon.svg?raw'
import {
  buildTranslationSessionKey,
  detectDirection,
  getServiceLabel,
  getSelectedServicesSummary,
  getTranslationServicePreferences,
  isAbortError,
  mapResultsByService,
  orderResultsByServices,
  setSelectedServices as persistSelectedServices,
  type TranslationDirection,
  type TranslationResultItem,
  type TranslationResultsByService,
  type TranslationServiceId,
  type TranslationServiceOption,
} from '../../utils/translation'

interface TranslateDialogResponse {
  success?: boolean
  results?: TranslationResultItem[]
  direction?: TranslationDirection
  error?: string
  isAbort?: boolean
}

type DialogStatus = 'loading' | 'success' | 'error'

const decodeHtmlEntities = (text: string): string => {
  const doc = new DOMParser().parseFromString(text, 'text/html')
  return doc.documentElement.textContent || text
}

const decodeResults = (results: TranslationResultItem[]): TranslationResultItem[] =>
  results.map(result =>
    result.status === 'success'
      ? { ...result, translation: decodeHtmlEntities(result.translation) }
      : result,
  )

const renderStrokeIcon = (
  paths: ReturnType<typeof svg>,
  options: {
    viewBox?: string
    filled?: boolean
    className?: string
  } = {},
) => svg`
  <svg
    class=${options.className ?? 'ui-icon'}
    xmlns="http://www.w3.org/2000/svg"
    viewBox=${options.viewBox ?? '0 0 24 24'}
    fill=${options.filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    ${paths}
  </svg>
`

const renderSunIcon = () =>
  renderStrokeIcon(svg`
    <circle cx="12" cy="12" r="4"></circle>
    <path d="M12 2v2"></path>
    <path d="M12 20v2"></path>
    <path d="M4.93 4.93l1.41 1.41"></path>
    <path d="M17.66 17.66l1.41 1.41"></path>
    <path d="M2 12h2"></path>
    <path d="M20 12h2"></path>
    <path d="M6.34 17.66l-1.41 1.41"></path>
    <path d="M19.07 4.93l-1.41 1.41"></path>
  `)

const renderMoonIcon = () =>
  renderStrokeIcon(svg`<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"></path>`)

const renderExpandIcon = () =>
  renderStrokeIcon(svg`
    <path d="M15 4h5v5"></path>
    <path d="M14 10l6-6"></path>
    <path d="M9 20H4v-5"></path>
    <path d="M10 14l-6 6"></path>
  `)

const renderCollapseIcon = () =>
  renderStrokeIcon(svg`
    <path d="M9 4H4v5"></path>
    <path d="M4 4l6 6"></path>
    <path d="M15 20h5v-5"></path>
    <path d="M20 20l-6-6"></path>
  `)

const renderCloseIcon = () =>
  renderStrokeIcon(svg`
    <path d="M18 6L6 18"></path>
    <path d="M6 6l12 12"></path>
  `)

const renderSpeakerIcon = () =>
  renderStrokeIcon(svg`
    <path d="M11 5L6 9H3v6h3l5 4V5z"></path>
    <path d="M15.5 8.5a5 5 0 0 1 0 7"></path>
    <path d="M18.5 5.5a9 9 0 0 1 0 13"></path>
  `)

const renderStopIcon = () =>
  renderStrokeIcon(
    svg`<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"></rect>`,
    { filled: true },
  )

const renderCopyIcon = () =>
  renderStrokeIcon(svg`
    <rect x="9" y="9" width="11" height="11" rx="2"></rect>
    <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"></path>
  `)

const renderCheckIcon = () => renderStrokeIcon(svg`<path d="M5 12l4 4L19 6"></path>`)

const renderErrorIcon = () =>
  renderStrokeIcon(svg`
    <circle cx="12" cy="12" r="9"></circle>
    <path d="M15 9l-6 6"></path>
    <path d="M9 9l6 6"></path>
  `)

const renderChevronDownIcon = (className = 'ui-icon') =>
  renderStrokeIcon(svg`<path d="M6 9l6 6 6-6"></path>`, { className })

const renderExternalLinkIcon = () =>
  renderStrokeIcon(svg`
    <path d="M14 5h5v5"></path>
    <path d="M10 14L19 5"></path>
    <path d="M19 13v5a1 1 0 0 1-1 1h-5"></path>
    <path d="M11 5H6a1 1 0 0 0-1 1v5"></path>
  `)

const renderRetryIcon = () =>
  renderStrokeIcon(svg`
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74"></path>
    <path d="M3 3v4h4"></path>
  `)

const renderGripIcon = () =>
  renderStrokeIcon(
    svg`
    <circle cx="3" cy="12" r="1.5"></circle>
    <circle cx="12" cy="12" r="1.5"></circle>
    <circle cx="21" cy="12" r="1.5"></circle>
  `,
    { filled: true, viewBox: '0 0 24 24' },
  )

const dialogStyles = css`
  :host {
    --bg: #222;
    --text: #fff;
    --sub: rgba(255, 255, 255, 0.75);
    --box1: rgba(255, 255, 255, 0.08);
    --box2: rgba(255, 255, 255, 0.12);
    --btn: rgba(255, 255, 255, 0.14);
    --btn-hover: rgba(255, 255, 255, 0.24);
    --border: rgba(255, 255, 255, 0.14);
    --active: #2563eb;
    --error: #ff8b8b;
  }

  dialog.light-theme {
    --bg: #fff;
    --text: #222;
    --sub: rgba(0, 0, 0, 0.62);
    --box1: #f3f4f6;
    --box2: #eef2ff;
    --btn: rgba(0, 0, 0, 0.05);
    --btn-hover: rgba(0, 0, 0, 0.1);
    --border: rgba(0, 0, 0, 0.1);
    --error: #dc2626;
  }

  dialog {
    padding: 20px;
    background: var(--bg);
    color: var(--text);
    border: none;
    border-radius: 14px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    max-width: 560px;
    width: min(84vw, 560px);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    position: fixed;
    margin: auto;
    inset: 0;
    user-select: none;
    max-height: 88vh;
    overflow: hidden;
    transition:
      transform 0.3s ease,
      opacity 0.3s ease;
    display: none;
  }

  dialog[open] {
    display: flex;
    flex-direction: column;
  }

  dialog.is-positioned {
    margin: 0;
    inset: auto;
  }

  dialog.dragging {
    transition: none !important;
  }

  dialog.expanded {
    width: 100% !important;
    height: 100% !important;
    max-width: 100% !important;
    max-height: 100vh !important;
    border-radius: 0 !important;
    margin: 0 !important;
    inset: 0 !important;
    transform: none !important;
  }

  dialog::backdrop {
    background: rgba(0, 0, 0, 0);
    transition: background 0.15s ease-in;
  }

  dialog.backdrop-active::backdrop {
    background: rgba(0, 0, 0, 0.5);
    transition: background 0.35s ease-out;
  }

  .wrap {
    height: 100%;
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow: hidden;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: move;
  }

  .title {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .title h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .icon {
    width: 20px;
    height: 20px;
    border-radius: 6px;
    overflow: hidden;
    display: flex;
  }

  .icon svg {
    width: 100%;
    height: 100%;
  }

  .ui-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    display: block;
    stroke: currentColor;
    fill: none;
  }

  .actions,
  .box-actions,
  .badges {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .theme-btn,
  .expand-btn,
  .close-btn,
  .icon-btn,
  .dir-btn,
  .dropdown-trigger {
    background: var(--btn);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 999px;
    cursor: pointer;
    transition:
      background 0.2s ease,
      font-color 0.2s ease;
    font: inherit;
    font-size: 13px;
  }

  .theme-btn,
  .expand-btn,
  .close-btn,
  .icon-btn {
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
  }

  .theme-btn .ui-icon,
  .expand-btn .ui-icon,
  .close-btn .ui-icon,
  .icon-btn .ui-icon {
    width: 14px;
    height: 14px;
  }

  .dir-btn,
  .dropdown-trigger {
    padding: 4px 10px;
  }

  .theme-btn:hover,
  .expand-btn:hover,
  .close-btn:hover,
  .icon-btn:hover:not(:disabled),
  .dir-btn:hover,
  .dropdown-trigger:hover,
  .service-option:hover {
    background: var(--btn-hover);
  }

  .icon-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .settings {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 16px;
    margin-top: 10px;
  }

  .setting-item {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .label {
    font-size: 12px;
    text-transform: uppercase;
    color: var(--sub);
    display: inline-flex;
    align-items: center;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .dir-btn.active {
    background: var(--active);
    border-color: var(--active);
    color: #fff;
  }

  .service-setting {
    min-width: 0;
  }

  .service-dropdown {
    position: relative;
    display: inline-block;
    max-width: min(100%, 260px);
  }

  .dropdown-trigger {
    width: auto;
    max-width: 100%;
    min-width: 180px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .dropdown-trigger-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dropdown-arrow {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 12px;
    height: 12px;
    transition: transform 0.2s ease;
  }

  .dropdown-arrow.open {
    transform: rotate(180deg);
  }

  .dropdown-menu {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    right: auto;
    min-width: 100%;
    width: max-content;
    max-width: min(320px, calc(92vw - 40px));
    box-sizing: border-box;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg);
    box-shadow: 0 16px 32px rgba(0, 0, 0, 0.24);
    display: flex;
    flex-direction: column;
    gap: 4px;
    z-index: 30;
  }

  .service-option {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 10px;
    cursor: pointer;
  }

  .service-option input {
    margin: 0;
  }

  .service-option span {
    font-size: 13px;
    color: var(--text);
  }

  .service-dropdown-error {
    padding: 4px 10px 2px;
    color: var(--error);
    font-size: 12px;
  }

  .box {
    background: var(--box1);
    padding: 14px;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .box.original {
    flex-shrink: 0;
    overflow: hidden;
  }

  .box.translation {
    background: var(--box2);
    flex: 1;
    min-height: 60px;
  }

  .resizer {
    height: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    position: relative;
    margin: -6px 0;
  }

  .resizer-handle {
    width: 80px;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: ns-resize;
    border-radius: 4px;
    transition: background-color 0.2s ease;
  }

  .resizer-handle:hover {
    background-color: var(--btn-hover);
  }

  .resizer.resizing .resizer-handle {
    background-color: var(--btn-hover);
  }

  .resizer-handle .ui-icon {
    width: 16px;
    height: 16px;
    opacity: 0.5;
    transition: opacity 0.2s ease;
  }

  .resizer-handle:hover .ui-icon,
  .resizer.resizing .resizer-handle .ui-icon {
    opacity: 0.8;
  }

  .box-head {
    font-size: 12px;
    color: var(--sub);
    margin-bottom: 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  .box-head strong {
    color: var(--text);
    font-size: 14px;
  }

  .text,
  .results {
    overflow-y: auto;
    min-height: 0;
  }

  .text {
    font-size: 15px;
    line-height: 1.6;
    user-select: text;
    word-break: break-word;
  }

  .original-text {
    min-height: 1.6em;
  }

  .results {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 2px;
    /* Push the scrollbar outward without changing the card content alignment. */
    padding-right: 12px;
    margin-right: -8px;
  }

  .result-card {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .result-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 2.5px 10px;
    font-size: 12px;
    background: var(--btn);
  }

  .result-text,
  .error-state {
    font-size: 15px;
    line-height: 1.6;
    word-break: break-word;
  }

  .error-state {
    color: var(--error);
    display: flex;
    font-size: 13px;
    gap: 8px;
    align-items: flex-start;
  }

  .error-state .ui-icon {
    width: 16px;
    height: 16px;
    margin-top: 3px;
    flex-shrink: 0;
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--sub);
    font-size: 14px;
  }

  .status-row-centered {
    justify-content: center;
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--border);
    border-top-color: var(--active);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .text::-webkit-scrollbar,
  .results::-webkit-scrollbar {
    width: 6px;
  }

  .text::-webkit-scrollbar-thumb,
  .results::-webkit-scrollbar-thumb {
    background: rgba(127, 127, 127, 0.35);
    border-radius: 3px;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`

/**
 * Uses Lit's standalone templating API (`html` + `render`) instead of
 * `LitElement`, because the content-script environment here cannot reliably
 * depend on a `CustomElementRegistry`.
 */
class TranslationDialogView {
  private readonly renderRoot: ShadowRoot
  public onClose?: () => void

  private originalText = ''
  private results: TranslationResultItem[] = []
  private direction: TranslationDirection = 'zh'
  private selectedServices: TranslationServiceId[] = []
  private visibleServiceOptions: TranslationServiceOption[] = []
  private cachedResultsByService: TranslationResultsByService = {}
  private pendingServices = new Set<TranslationServiceId>()
  private sessionKey = ''
  private theme: 'light' | 'dark' = 'light'
  private status: DialogStatus = 'loading'
  private errorMessage = ''
  private isReadingOriginal = false
  private readingResultService: TranslationServiceId | null = null
  private isServiceMenuOpen = false
  private isDialogExpanded = false
  private isBackdropActive = false
  private isDialogPositioned = false
  private isDialogDragging = false
  private dragOffset = { x: 0, y: 0 }
  private copiedService: TranslationServiceId | null = null
  private closingTimer: number | null = null
  private copyFeedbackTimer: number | null = null
  private presentationVersion = 0
  private translationBatchVersion = 0
  private retryRequestSequence = 0
  private retryRequestVersions: Partial<Record<TranslationServiceId, number>> = {}
  private activeDragMoveHandler: ((event: MouseEvent) => void) | null = null
  private activeDragUpHandler: (() => void) | null = null
  private originalTextHeight = 120 // 原文区域高度
  private isResizing = false // 是否正在拖动分隔条
  private resizeDragMoveHandler: ((event: MouseEvent) => void) | null = null
  private resizeDragUpHandler: (() => void) | null = null

  constructor(renderRoot: ShadowRoot) {
    this.renderRoot = renderRoot
    this.renderView()
  }

  public showLoading(originalText: string): void {
    void this.showLoadingInternal(originalText)
  }

  public updateSuccess(results: TranslationResultItem[], direction?: TranslationDirection): void {
    this.applyResults(results, direction)
    this.errorMessage = ''
    this.pendingServices = new Set()
    this.status = 'success'
    this.isServiceMenuOpen = false
    this.renderView()
    this.presentDialog()
  }

  public updateIncremental(
    results: TranslationResultItem[],
    direction?: TranslationDirection,
  ): void {
    this.applyResults(results, direction)

    // 更新 pendingServices: 移除已完成的服务
    const completedServices = new Set(results.map(r => r.service))
    this.pendingServices = new Set(
      Array.from(this.pendingServices).filter(service => !completedServices.has(service)),
    )

    // 如果还有 pending 服务,保持 loading 状态;否则切换到 success
    if (this.pendingServices.size === 0 && this.results.length > 0) {
      this.status = 'success'
      this.errorMessage = ''
    } else if (this.results.length > 0) {
      this.status = 'success'
    }

    this.renderView()
    this.presentDialog()
  }

  public updateError(message: string): void {
    this.status = 'error'
    this.errorMessage = message
    this.pendingServices = new Set()
    this.syncVisibleResults()
    this.isServiceMenuOpen = false
    this.renderView()
    this.presentDialog()
  }

  public showError(message: string): void {
    this.status = 'error'
    this.errorMessage = message
    this.pendingServices = new Set()
    this.syncVisibleResults()
    this.isServiceMenuOpen = false
    this.stopReading()
    this.renderView()
    this.presentDialog()
  }

  public showDetail(
    originalText: string,
    results: TranslationResultItem[],
    direction?: TranslationDirection,
  ): void {
    void this.showDetailInternal(originalText, results, direction)
  }

  /**
   * Keeps the in-page dialog aligned with the background cache so provider
   * toggles only fetch missing services and removed cards disappear instantly.
   */
  private async performTranslation(forceRefresh = false): Promise<void> {
    if (this.selectedServices.length === 0) {
      this.status = 'error'
      this.errorMessage = '至少选择一个翻译服务'
      this.syncVisibleResults()
      this.renderView()
      return
    }

    const currentSessionKey = buildTranslationSessionKey(this.originalText, this.direction)
    const isSameSession = this.sessionKey === currentSessionKey

    if (!isSameSession || forceRefresh) {
      this.abortOngoingTranslation()
      this.resetSession(this.originalText, this.direction)
      this.stopReading()
    }

    const requestServices =
      forceRefresh || !isSameSession
        ? [...this.selectedServices]
        : this.selectedServices.filter(
            service => !this.cachedResultsByService[service] && !this.pendingServices.has(service),
          )
    const batchVersion = this.bumpTranslationBatchVersion()
    const requestSessionKey = this.sessionKey

    this.pendingServices = new Set([...this.pendingServices, ...requestServices])
    this.errorMessage = ''
    this.isServiceMenuOpen = false

    if (this.results.length === 0 && this.pendingServices.size > 0) {
      this.status = 'loading'
    } else if (this.results.length > 0) {
      this.status = 'success'
    }
    this.renderView()

    try {
      const response = (await browser.runtime.sendMessage({
        action: 'translate',
        text: this.originalText,
        services: this.selectedServices,
        direction: this.direction,
        forceRefresh,
      })) as TranslateDialogResponse
      if (!this.isActiveBatchRequest(batchVersion, requestSessionKey)) return

      if (response.success && Array.isArray(response.results)) {
        this.applyResults(response.results, response.direction)
        return
      }

      if (response.isAbort) return

      this.errorMessage = response.error || '翻译失败'
      if (this.results.length === 0) {
        this.status = 'error'
      }
    } catch (error: unknown) {
      if (isAbortError(error)) return
      if (!this.isActiveBatchRequest(batchVersion, requestSessionKey)) return

      this.errorMessage = '翻译失败，请重试'
      if (this.results.length === 0) {
        this.status = 'error'
      }
    } finally {
      if (!this.isActiveBatchRequest(batchVersion, requestSessionKey)) return

      const nextPendingServices = new Set(this.pendingServices)
      requestServices.forEach(service => nextPendingServices.delete(service))
      this.pendingServices = nextPendingServices
      this.syncVisibleResults()

      if (this.pendingServices.size > 0 && this.results.length === 0) {
        this.status = 'loading'
      } else if (this.results.length > 0) {
        this.status = 'success'
      } else if (this.errorMessage) {
        this.status = 'error'
      }
      this.renderView()
    }
  }

  private async showLoadingInternal(originalText: string): Promise<void> {
    const presentationVersion = this.bumpPresentationVersion()
    this.status = 'loading'
    this.originalText = originalText
    this.errorMessage = ''
    this.isServiceMenuOpen = false
    this.isDialogExpanded = false
    this.direction = detectDirection(originalText)
    this.resetSession(originalText, this.direction)
    this.stopReading()
    this.resetDialogPosition()
    await this.loadSettings()
    if (!this.isActivePresentation(presentationVersion)) return

    this.pendingServices = new Set(this.selectedServices)
    this.syncVisibleResults()
    this.renderView()
    this.presentDialog()
  }

  private async showDetailInternal(
    originalText: string,
    results: TranslationResultItem[],
    direction?: TranslationDirection,
  ): Promise<void> {
    const presentationVersion = this.bumpPresentationVersion()
    this.status = 'success'
    this.originalText = originalText
    this.isServiceMenuOpen = false
    this.isDialogExpanded = false
    this.direction = direction || detectDirection(originalText)
    this.resetSession(originalText, this.direction)
    this.pendingServices = new Set()
    this.applyResults(results, this.direction)
    this.stopReading()
    this.resetDialogPosition()
    await this.loadSettings()
    if (!this.isActivePresentation(presentationVersion)) return

    this.syncVisibleResults()
    this.renderView()
    this.presentDialog()
  }

  private async loadSettings(): Promise<void> {
    const [preferences, storage] = await Promise.all([
      getTranslationServicePreferences(),
      browser.storage.local.get(['theme']),
    ])

    this.selectedServices = preferences.selectedServices
    this.visibleServiceOptions = preferences.visibleServiceOptions
    this.theme = storage.theme === 'light' ? 'light' : 'dark'
    this.syncVisibleResults()
  }

  private resetSession(originalText: string, direction: TranslationDirection): void {
    this.sessionKey = buildTranslationSessionKey(originalText, direction)
    this.cachedResultsByService = {}
    this.results = []
    this.pendingServices = new Set()
  }

  private syncVisibleResults(): void {
    this.results = orderResultsByServices(this.cachedResultsByService, this.selectedServices)
  }

  private bumpPresentationVersion(): number {
    this.presentationVersion += 1
    return this.presentationVersion
  }

  private isActivePresentation(version: number): boolean {
    return version === this.presentationVersion
  }

  private bumpTranslationBatchVersion(): number {
    this.translationBatchVersion += 1
    this.retryRequestVersions = {}
    return this.translationBatchVersion
  }

  private isActiveBatchRequest(version: number, sessionKey: string): boolean {
    return version === this.translationBatchVersion && sessionKey.length > 0 && sessionKey === this.sessionKey
  }

  private bumpRetryRequestVersion(service: TranslationServiceId): number {
    this.retryRequestSequence += 1
    this.retryRequestVersions[service] = this.retryRequestSequence
    return this.retryRequestSequence
  }

  private isActiveRetryRequest(
    service: TranslationServiceId,
    retryVersion: number,
    batchVersion: number,
    sessionKey: string,
  ): boolean {
    return (
      this.isActiveBatchRequest(batchVersion, sessionKey) &&
      this.retryRequestVersions[service] === retryVersion
    )
  }

  private applyResults(results: TranslationResultItem[], direction?: TranslationDirection): void {
    if (direction) {
      this.direction = direction
    }

    this.cachedResultsByService = {
      ...this.cachedResultsByService,
      ...mapResultsByService(decodeResults(results)),
    }
    this.syncVisibleResults()
  }

  private presentDialog(): void {
    const wasClosing = this.closingTimer !== null
    if (this.closingTimer) {
      window.clearTimeout(this.closingTimer)
      this.closingTimer = null
    }

    const dialog = this.getDialogElement()
    if (!dialog) return

    if (!dialog.open) {
      dialog.showModal()
      this.animateIn()
    } else if (wasClosing) {
      this.animateIn()
    }
  }

  private animateIn(): void {
    const dialog = this.getDialogElement()
    if (!dialog) return
    const presentationVersion = this.presentationVersion

    dialog.style.transform = 'scale(.86)'
    dialog.style.opacity = '0'
    this.isBackdropActive = false
    this.syncDialogRuntimeState()

    window.setTimeout(() => {
      if (!this.isActivePresentation(presentationVersion)) return

      const activeDialog = this.getDialogElement()
      if (!activeDialog) return
      activeDialog.style.transition =
        'transform .35s cubic-bezier(.34,1.56,.64,1), opacity .35s ease-out'
      activeDialog.style.transform = 'scale(1)'
      activeDialog.style.opacity = '1'
      this.isBackdropActive = true
      this.syncDialogRuntimeState()
    }, 10)
  }

  private closeDialog(): void {
    const dialog = this.getDialogElement()
    if (!dialog) return

    this.bumpPresentationVersion()
    this.bumpTranslationBatchVersion()
    this.abortOngoingTranslation()
    this.stopReading()
    this.clearDragListeners()
    this.clearResizeListeners()
    this.isDialogDragging = false
    this.isResizing = false
    this.isServiceMenuOpen = false
    if (this.closingTimer) {
      window.clearTimeout(this.closingTimer)
    }

    dialog.style.transition = 'transform .15s ease-in, opacity .15s ease-in'
    dialog.style.transform = 'scale(.86)'
    dialog.style.opacity = '0'
    this.isBackdropActive = false
    this.syncDialogRuntimeState()

    this.closingTimer = window.setTimeout(() => {
      this.getDialogElement()?.close()
      this.closingTimer = null
      this.onClose?.()
    }, 150)
  }

  private abortOngoingTranslation(): void {
    browser.runtime.sendMessage({ action: 'abortTranslation' }).catch(() => {})
  }

  private stopReading(): void {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    this.isReadingOriginal = false
    this.readingResultService = null
  }

  private isTranslating(): boolean {
    return this.pendingServices.size > 0
  }

  private resetDialogPosition(): void {
    const dialog = this.getDialogElement()
    if (!dialog) return
    dialog.style.left = ''
    dialog.style.top = ''
    this.isDialogPositioned = false
    this.isDialogDragging = false
    this.syncDialogRuntimeState()
  }

  private async toggleTheme(): Promise<void> {
    this.theme = this.theme === 'light' ? 'dark' : 'light'
    await browser.storage.local.set({ theme: this.theme })
    this.renderView()
  }

  /**
   * Copy feedback is tracked in component state so Lit can re-render the icon
   * without fighting direct DOM writes.
   */
  private async copyToClipboard(text: string, service: TranslationServiceId): Promise<void> {
    if (!text) return

    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const textArea = document.createElement('textarea')
      textArea.value = text
      textArea.style.position = 'fixed'
      textArea.style.left = '-9999px'
      this.renderRoot.appendChild(textArea)
      textArea.focus()
      textArea.select()
      document.execCommand('copy')
      this.renderRoot.removeChild(textArea)
    }

    this.copiedService = service
    this.renderView()
    this.clearCopyFeedbackTimer()
    this.copyFeedbackTimer = window.setTimeout(() => {
      this.copiedService = null
      this.copyFeedbackTimer = null
      this.renderView()
    }, 2000)
  }

  private clearCopyFeedbackTimer(): void {
    if (this.copyFeedbackTimer) {
      window.clearTimeout(this.copyFeedbackTimer)
      this.copyFeedbackTimer = null
    }
  }

  private getDialogElement(): HTMLDialogElement | null {
    return this.renderRoot.querySelector('#translation-dialog')
  }

  private renderView(): void {
    render(this.renderTemplate(), this.renderRoot)
    this.syncDialogRuntimeState()
  }

  /**
   * Lit will overwrite the dialog class list on re-render, so runtime-only
   * classes must be restored from state after each render cycle.
   */
  private syncDialogRuntimeState(): void {
    const dialog = this.getDialogElement()
    if (!dialog) return

    dialog.classList.toggle('backdrop-active', this.isBackdropActive)
    dialog.classList.toggle('is-positioned', this.isDialogPositioned)
    dialog.classList.toggle('dragging', this.isDialogDragging)
  }

  private renderLoadingIndicator(centered = false) {
    return html`
      <div class=${`status-row${centered ? ' status-row-centered' : ''}`} aria-label="翻译中">
        <div class="spinner" aria-hidden="true"></div>
      </div>
    `
  }

  private renderPendingCard(service: TranslationServiceId) {
    return html`
      <article class="result-card">
        <div class="result-head">
          <div class="badges">
            <span class="badge">${getServiceLabel(service)}</span>
          </div>
        </div>
        ${this.renderLoadingIndicator()}
      </article>
    `
  }

  private renderResultCards() {
    const visibleServices = this.selectedServices.filter(
      service => this.cachedResultsByService[service] || this.pendingServices.has(service),
    )

    if (visibleServices.length === 0) {
      if (this.isTranslating()) {
        return this.renderLoadingIndicator(true)
      }

      return html`
        <div class="error-state">
          ${renderErrorIcon()}
          <span>${this.errorMessage || '暂无翻译结果'}</span>
        </div>
      `
    }

    return visibleServices.map(service => {
      const result = this.cachedResultsByService[service]
      const pending = this.pendingServices.has(service)

      if (!result) {
        return this.renderPendingCard(service)
      }

      const canInteract = result.status === 'success'
      const speaking = this.readingResultService === result.service

      return html`
        <article class="result-card">
          <div class="result-head">
            <div class="badges">
              <span class="badge">${result.serviceLabel}</span>
              ${pending ? html` <span class="badge">更新中</span> ` : null}
            </div>
            <div class="actions">
              ${result.status === 'error'
                ? html`
                    <button
                      class="icon-btn"
                      type="button"
                      title="重试"
                      @click=${() => {
                        void this.handleRetryService(result.service)
                      }}
                    >
                      ${renderRetryIcon()}
                    </button>
                  `
                : html`
                    <button
                      class="icon-btn"
                      type="button"
                      data-tts-service=${result.service}
                      title=${speaking ? '停止朗读' : '朗读'}
                      ?disabled=${!canInteract}
                      @click=${() => {
                        void this.handleResultSpeech(result.service)
                      }}
                    >
                      ${speaking ? renderStopIcon() : renderSpeakerIcon()}
                    </button>
                    <button
                      class="icon-btn"
                      type="button"
                      data-copy-service=${result.service}
                      title="复制"
                      ?disabled=${!canInteract}
                      @click=${() => {
                        void this.handleCopyService(result.service)
                      }}
                    >
                      ${this.copiedService === result.service
                        ? renderCheckIcon()
                        : renderCopyIcon()}
                    </button>
                  `}
            </div>
          </div>
          ${result.status === 'success'
            ? html`<div class="result-text">${result.translation}</div>`
            : html`
                <div class="error-state">
                  ${renderErrorIcon()}
                  <span>${result.error}</span>
                </div>
              `}
        </article>
      `
    })
  }

  private async handleDirectionChange(newDirection: TranslationDirection): Promise<void> {
    if (newDirection === this.direction) return
    this.isServiceMenuOpen = false
    this.direction = newDirection
    await this.performTranslation(true)
  }

  private async handleServiceToggle(service: TranslationServiceId): Promise<void> {
    const nextServices = this.selectedServices.includes(service)
      ? this.selectedServices.filter(item => item !== service)
      : [...this.selectedServices, service]

    this.selectedServices = nextServices
    await persistSelectedServices(nextServices)

    if (!nextServices.includes(service) && this.readingResultService === service) {
      this.stopReading()
    }

    if (!nextServices.includes(service)) {
      const nextPendingServices = new Set(this.pendingServices)
      nextPendingServices.delete(service)
      this.pendingServices = nextPendingServices
    }

    this.syncVisibleResults()

    if (nextServices.length === 0) {
      this.status = 'error'
      this.errorMessage = '至少选择一个翻译服务'
      this.renderView()
      return
    }

    this.errorMessage = ''
    await this.performTranslation(false)
  }

  /**
   * Retries only the failed provider so successful cards remain visible while
   * the background refreshes the targeted service in place.
   */
  private async handleRetryService(service: TranslationServiceId): Promise<void> {
    if (!this.selectedServices.includes(service) || this.pendingServices.has(service)) {
      return
    }
    const batchVersion = this.translationBatchVersion
    const requestSessionKey = this.sessionKey
    const retryVersion = this.bumpRetryRequestVersion(service)

    if (this.readingResultService === service) {
      this.stopReading()
    }

    const nextCachedResultsByService = { ...this.cachedResultsByService }
    delete nextCachedResultsByService[service]
    this.cachedResultsByService = nextCachedResultsByService
    this.pendingServices = new Set([...this.pendingServices, service])
    this.errorMessage = ''
    this.syncVisibleResults()
    this.status = this.results.length === 0 ? 'loading' : 'success'
    this.renderView()

    try {
      const response = (await browser.runtime.sendMessage({
        action: 'translate',
        text: this.originalText,
        services: [service],
        direction: this.direction,
        forceRefresh: true,
        preserveSelection: true,
      })) as TranslateDialogResponse
      if (!this.isActiveRetryRequest(service, retryVersion, batchVersion, requestSessionKey)) return

      if (response.success && Array.isArray(response.results)) {
        this.applyResults(response.results, response.direction)
        return
      }

      if (response.isAbort) return

      this.errorMessage = response.error || `${getServiceLabel(service)} 翻译失败`
      if (this.results.length === 0) {
        this.status = 'error'
      }
    } catch (error: unknown) {
      if (isAbortError(error)) return
      if (!this.isActiveRetryRequest(service, retryVersion, batchVersion, requestSessionKey)) return

      this.errorMessage = `${getServiceLabel(service)} 翻译失败，请重试`
      if (this.results.length === 0) {
        this.status = 'error'
      }
    } finally {
      if (!this.isActiveRetryRequest(service, retryVersion, batchVersion, requestSessionKey)) return

      const nextPendingServices = new Set(this.pendingServices)
      nextPendingServices.delete(service)
      this.pendingServices = nextPendingServices
      this.syncVisibleResults()

      if (this.pendingServices.size > 0 && this.results.length === 0) {
        this.status = 'loading'
      } else if (this.results.length > 0) {
        this.status = 'success'
      } else if (this.errorMessage) {
        this.status = 'error'
      }
      this.renderView()
    }
  }

  private handleWrapClick(event: MouseEvent): void {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (this.isServiceMenuOpen && !target.closest('.service-dropdown')) {
      this.isServiceMenuOpen = false
      this.renderView()
    }
  }

  private handleExpandToggle(): void {
    this.isDialogExpanded = !this.isDialogExpanded
    this.isServiceMenuOpen = false
    this.resetDialogPosition()
    this.renderView()
  }

  private handleDialogClick(event: MouseEvent): void {
    const dialog = this.getDialogElement()
    if (!dialog || event.target !== dialog) {
      return
    }

    const rect = dialog.getBoundingClientRect()
    const isBackdropClick =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom

    if (isBackdropClick) {
      this.closeDialog()
    }
  }

  private handleDialogCancel(event: Event): void {
    event.preventDefault()
    this.closeDialog()
  }

  private handleHeaderMouseDown(event: MouseEvent): void {
    const dialog = this.getDialogElement()
    if (this.isDialogExpanded || !dialog) return

    const target = event.target
    if (target instanceof HTMLElement && target.closest('button')) {
      return
    }

    let moved = false
    const rect = dialog.getBoundingClientRect()
    this.dragOffset = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }

    this.clearDragListeners()

    this.activeDragMoveHandler = (moveEvent: MouseEvent) => {
      const activeDialog = this.getDialogElement()
      if (!activeDialog) return

      if (!moved) {
        moved = true
        this.isDialogDragging = true
        this.isDialogPositioned = true
        this.syncDialogRuntimeState()
      }

      const nextX = Math.max(
        0,
        Math.min(moveEvent.clientX - this.dragOffset.x, window.innerWidth - rect.width),
      )
      const nextY = Math.max(
        0,
        Math.min(moveEvent.clientY - this.dragOffset.y, window.innerHeight - rect.height),
      )

      activeDialog.style.left = `${nextX}px`
      activeDialog.style.top = `${nextY}px`
    }

    this.activeDragUpHandler = () => {
      this.isDialogDragging = false
      this.syncDialogRuntimeState()
      this.clearDragListeners()
    }

    window.addEventListener('mousemove', this.activeDragMoveHandler)
    window.addEventListener('mouseup', this.activeDragUpHandler)
  }

  private clearDragListeners(): void {
    if (this.activeDragMoveHandler) {
      window.removeEventListener('mousemove', this.activeDragMoveHandler)
      this.activeDragMoveHandler = null
    }
    if (this.activeDragUpHandler) {
      window.removeEventListener('mouseup', this.activeDragUpHandler)
      this.activeDragUpHandler = null
    }
  }

  private handleResizerMouseDown(event: MouseEvent): void {
    event.preventDefault()
    event.stopPropagation()

    this.isResizing = true
    const startY = event.clientY
    const startHeight = this.originalTextHeight

    this.clearResizeListeners()

    this.resizeDragMoveHandler = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY
      const newHeight = Math.max(60, startHeight + deltaY) // 最小高度 60px
      this.originalTextHeight = newHeight
      this.renderView()
    }

    this.resizeDragUpHandler = () => {
      this.isResizing = false
      this.clearResizeListeners()
      this.renderView()
    }

    window.addEventListener('mousemove', this.resizeDragMoveHandler)
    window.addEventListener('mouseup', this.resizeDragUpHandler)
  }

  private clearResizeListeners(): void {
    if (this.resizeDragMoveHandler) {
      window.removeEventListener('mousemove', this.resizeDragMoveHandler)
      this.resizeDragMoveHandler = null
    }
    if (this.resizeDragUpHandler) {
      window.removeEventListener('mouseup', this.resizeDragUpHandler)
      this.resizeDragUpHandler = null
    }
  }

  private handleYoudaoOpen(): void {
    window.open(
      `https://www.youdao.com/result?word=${encodeURIComponent(this.originalText)}&lang=en`,
      '_blank',
    )
  }

  private handleOriginalSpeech(): void {
    if (this.isReadingOriginal) {
      window.speechSynthesis.cancel()
      this.isReadingOriginal = false
      this.readingResultService = null
      this.renderView()
      return
    }

    window.speechSynthesis.cancel()
    this.readingResultService = null

    const utterance = new SpeechSynthesisUtterance(this.originalText)
    utterance.lang = this.direction === 'zh' ? 'en-US' : 'zh-CN'
    utterance.onstart = () => {
      this.isReadingOriginal = true
      this.renderView()
    }
    utterance.onend = () => {
      this.isReadingOriginal = false
      this.renderView()
    }
    utterance.onerror = () => {
      this.isReadingOriginal = false
      this.renderView()
    }
    window.speechSynthesis.speak(utterance)
  }

  private async handleCopyService(service: TranslationServiceId): Promise<void> {
    const result = this.cachedResultsByService[service]
    if (result?.status !== 'success') return
    await this.copyToClipboard(result.translation, service)
  }

  private async handleResultSpeech(service: TranslationServiceId): Promise<void> {
    const result = this.cachedResultsByService[service]
    if (!result || result.status !== 'success') return

    if (this.readingResultService === service) {
      window.speechSynthesis.cancel()
      this.readingResultService = null
      this.renderView()
      return
    }

    window.speechSynthesis.cancel()
    this.isReadingOriginal = false

    const utterance = new SpeechSynthesisUtterance(result.translation)
    utterance.lang = result.direction === 'zh' ? 'zh-CN' : 'en-US'
    utterance.onstart = () => {
      this.readingResultService = service
      this.renderView()
    }
    utterance.onend = () => {
      this.readingResultService = null
      this.renderView()
    }
    utterance.onerror = () => {
      this.readingResultService = null
      this.renderView()
    }
    window.speechSynthesis.speak(utterance)
  }

  private renderTemplate() {
    return html`
      <style>
        ${dialogStyles.cssText}
      </style>
      <dialog
        id="translation-dialog"
        class=${[
          this.theme === 'light' ? 'light-theme' : '',
          this.isDialogExpanded ? 'expanded' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        @click=${(event: MouseEvent) => this.handleDialogClick(event)}
        @cancel=${(event: Event) => this.handleDialogCancel(event)}
      >
        <div class="wrap" @click=${(event: MouseEvent) => this.handleWrapClick(event)}>
          <div
            class="header"
            @mousedown=${(event: MouseEvent) => this.handleHeaderMouseDown(event)}
          >
            <div class="title">
              <div class="icon">${unsafeSVG(iconSvg)}</div>
              <h3>
                ${this.status === 'error' && this.results.length === 0 ? '翻译失败' : '中英直译'}
              </h3>
            </div>
            <div class="actions">
              <button
                class="theme-btn"
                id="theme-btn"
                title="切换主题"
                @click=${() => {
                  this.isServiceMenuOpen = false
                  void this.toggleTheme()
                }}
              >
                ${this.theme === 'dark' ? renderMoonIcon() : renderSunIcon()}
              </button>
              <button
                class="expand-btn"
                id="expand-btn"
                title=${this.isDialogExpanded ? '还原' : '全屏'}
                @click=${() => this.handleExpandToggle()}
              >
                ${this.isDialogExpanded ? renderCollapseIcon() : renderExpandIcon()}
              </button>
              <button
                class="close-btn"
                id="close-btn"
                title="关闭"
                @click=${() => {
                  this.isServiceMenuOpen = false
                  this.closeDialog()
                }}
              >
                ${renderCloseIcon()}
              </button>
            </div>
          </div>

          <div class="settings">
            <div class="setting-item">
              <span class="label">翻译目标</span>
              <div class="row">
                <button
                  class=${`dir-btn ${this.direction === 'en' ? 'active' : ''}`}
                  type="button"
                  data-direction="en"
                  @click=${() => {
                    void this.handleDirectionChange('en')
                  }}
                >
                  到英文
                </button>
                <button
                  class=${`dir-btn ${this.direction === 'zh' ? 'active' : ''}`}
                  type="button"
                  data-direction="zh"
                  @click=${() => {
                    void this.handleDirectionChange('zh')
                  }}
                >
                  到中文
                </button>
              </div>
            </div>

            <div class="setting-item service-setting">
              <span class="label">翻译服务</span>
              <div class="service-dropdown">
                <button
                  class="dropdown-trigger"
                  id="service-dropdown-trigger"
                  type="button"
                  @click=${() => {
                    this.isServiceMenuOpen = !this.isServiceMenuOpen
                    this.renderView()
                  }}
                >
                  <span class="dropdown-trigger-text">
                    ${getSelectedServicesSummary(this.selectedServices)}
                  </span>
                  <span class=${`dropdown-arrow ${this.isServiceMenuOpen ? 'open' : ''}`}
                    >${renderChevronDownIcon()}</span
                  >
                </button>

                ${this.isServiceMenuOpen
                  ? html`
                      <div class="dropdown-menu">
                        ${this.visibleServiceOptions.map(serviceOption => {
                          const active = this.selectedServices.includes(serviceOption.id)
                          return html`
                            <label class="service-option">
                              <input
                                type="checkbox"
                                data-service-toggle=${serviceOption.id}
                                .checked=${active}
                                @change=${() => {
                                  void this.handleServiceToggle(serviceOption.id)
                                }}
                              />
                              <span>${serviceOption.label}</span>
                            </label>
                          `
                        })}
                        ${this.selectedServices.length === 0
                          ? html` <div class="service-dropdown-error">至少选择一个翻译服务</div> `
                          : null}
                      </div>
                    `
                  : null}
              </div>
            </div>
          </div>

          <section class="box original" style="max-height: ${this.originalTextHeight}px;">
            <div class="box-head">
              <strong>原文</strong>
              <div class="box-actions">
                <button
                  class="icon-btn"
                  id="tts-btn"
                  title=${this.isReadingOriginal ? '停止朗读' : '朗读原文'}
                  @click=${() => this.handleOriginalSpeech()}
                >
                  ${this.isReadingOriginal ? renderStopIcon() : renderSpeakerIcon()}
                </button>
                <button
                  class="icon-btn"
                  id="youdao-btn"
                  title="在有道词典中查看"
                  @click=${() => this.handleYoudaoOpen()}
                >
                  ${renderExternalLinkIcon()}
                </button>
              </div>
            </div>
            <div class="text original-text">${this.originalText}</div>
          </section>

          <div class="resizer ${this.isResizing ? 'resizing' : ''}" title="可按住上下拖动">
            <div
              class="resizer-handle"
              @mousedown=${(event: MouseEvent) => this.handleResizerMouseDown(event)}
            >
              ${renderGripIcon()}
            </div>
          </div>

          <section class="box translation">
            <div class="box-head">
              <div class="badges">
                <strong>翻译结果</strong>
                ${this.results.length > 0 ? html`<span>${this.results.length} 个服务</span>` : null}
              </div>
            </div>
            <div class="results">${this.renderResultCards()}</div>
          </section>
        </div>
      </dialog>
    `
  }
}

export class TranslationDialog {
  private container: HTMLElement
  private shadowRoot: ShadowRoot
  private element: TranslationDialogView

  constructor() {
    this.container = document.createElement('div')
    this.container.id = 'translation-extension-root'
    this.shadowRoot = this.container.attachShadow({ mode: 'open' })
    this.element = new TranslationDialogView(this.shadowRoot)
    document.body.appendChild(this.container)
  }

  public get onClose(): (() => void) | undefined {
    return this.element.onClose
  }

  public set onClose(handler: (() => void) | undefined) {
    this.element.onClose = handler
  }

  public showLoading(originalText: string): void {
    this.ensureInDocument()
    this.element.showLoading(originalText)
  }

  public updateSuccess(results: TranslationResultItem[], direction?: TranslationDirection): void {
    this.ensureInDocument()
    this.element.updateSuccess(results, direction)
  }

  public updateIncremental(
    results: TranslationResultItem[],
    direction?: TranslationDirection,
  ): void {
    this.ensureInDocument()
    this.element.updateIncremental(results, direction)
  }

  public updateError(message: string): void {
    this.ensureInDocument()
    this.element.updateError(message)
  }

  public showError(message: string): void {
    this.ensureInDocument()
    this.element.showError(message)
  }

  public showDetail(
    originalText: string,
    results: TranslationResultItem[],
    direction?: TranslationDirection,
  ): void {
    this.ensureInDocument()
    this.element.showDetail(originalText, results, direction)
  }

  private ensureInDocument(): void {
    if (!document.body.contains(this.container)) {
      document.body.appendChild(this.container)
    }
  }
}
