import { browser } from "wxt/browser";
import iconSvg from "../../assets/icon.svg?raw";
import {
  buildTranslationSessionKey,
  detectDirection,
  getServiceLabel,
  getSelectedServicesSummary,
  getTranslationServicePreferences,
  isAbortError,
  isTranslationServiceId,
  mapResultsByService,
  orderResultsByServices,
  setSelectedServices as persistSelectedServices,
  type TranslationDirection,
  type TranslationResultItem,
  type TranslationResultsByService,
  type TranslationServiceOption,
  type TranslationServiceId,
} from "../../utils/translation";

interface TranslateDialogResponse {
  success?: boolean;
  results?: TranslationResultItem[];
  direction?: TranslationDirection;
  error?: string;
  isAbort?: boolean;
}

type DialogStatus = "loading" | "success" | "error";

const decodeHtmlEntities = (text: string): string => {
  const doc = new DOMParser().parseFromString(text, "text/html");
  return doc.documentElement.textContent || text;
};

const decodeResults = (results: TranslationResultItem[]): TranslationResultItem[] =>
  results.map((result) =>
    result.status === "success"
      ? { ...result, translation: decodeHtmlEntities(result.translation) }
      : result,
  );

export class TranslationDialog {
  private container: HTMLElement;
  private shadowRoot: ShadowRoot;
  private dialog: HTMLDialogElement | null = null;
  private originalText = "";
  private results: TranslationResultItem[] = [];
  private direction: TranslationDirection = "zh";
  private selectedServices: TranslationServiceId[] = [];
  private visibleServiceOptions: TranslationServiceOption[] = [];
  private cachedResultsByService: TranslationResultsByService = {};
  private pendingServices = new Set<TranslationServiceId>();
  private sessionKey = "";
  private theme: "light" | "dark" = "light";
  private status: DialogStatus = "loading";
  private errorMessage = "";
  private isReadingOriginal = false;
  private readingResultService: TranslationServiceId | null = null;
  private isServiceMenuOpen = false;
  private isDialogExpanded = false;
  private dragOffset = { x: 0, y: 0 };
  private closingTimer: number | null = null;
  public onClose?: () => void;

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "translation-extension-root";
    this.shadowRoot = this.container.attachShadow({ mode: "open" });
    document.body.appendChild(this.container);
    this.render();
  }

  public showLoading(originalText: string): void {
    this.status = "loading";
    this.originalText = originalText;
    this.errorMessage = "";
    this.isServiceMenuOpen = false;
    this.isDialogExpanded = false;
    this.direction = detectDirection(originalText);
    this.resetSession(originalText, this.direction);
    this.stopReading();
    if (this.dialog) {
      this.dialog.style.left = "";
      this.dialog.style.top = "";
      this.dialog.classList.remove("is-positioned");
    }
    void this.loadSettings().then(() => {
      this.pendingServices = new Set(this.selectedServices);
      this.syncVisibleResults();
      this.ensureInDocument();
      this.render();
      this.presentDialog();
    });
  }

  public updateSuccess(results: TranslationResultItem[], direction?: TranslationDirection): void {
    this.applyResults(results, direction);
    this.errorMessage = "";
    this.pendingServices.clear();
    this.status = "success";
    this.isServiceMenuOpen = false;
    this.ensureInDocument();
    this.render();
    this.presentDialog();
  }

  public updateError(message: string): void {
    this.status = "error";
    this.errorMessage = message;
    this.pendingServices.clear();
    this.syncVisibleResults();
    this.isServiceMenuOpen = false;
    this.ensureInDocument();
    this.render();
    this.presentDialog();
  }

  public showError(message: string): void {
    this.status = "error";
    this.errorMessage = message;
    this.pendingServices.clear();
    this.syncVisibleResults();
    this.isServiceMenuOpen = false;
    this.stopReading();
    this.ensureInDocument();
    this.render();
    this.presentDialog();
  }

  public showDetail(
    originalText: string,
    results: TranslationResultItem[],
    direction?: TranslationDirection,
  ): void {
    this.status = "success";
    this.originalText = originalText;
    this.isServiceMenuOpen = false;
    this.isDialogExpanded = false;
    this.direction = direction || detectDirection(originalText);
    this.resetSession(originalText, this.direction);
    this.pendingServices.clear();
    this.applyResults(results, this.direction);
    this.stopReading();
    if (this.dialog) {
      this.dialog.style.left = "";
      this.dialog.style.top = "";
      this.dialog.classList.remove("is-positioned");
    }
    void this.loadSettings().then(() => {
      this.syncVisibleResults();
      this.ensureInDocument();
      this.render();
      this.presentDialog();
    });
  }

  private async loadSettings(): Promise<void> {
    const [preferences, storage] = await Promise.all([
      getTranslationServicePreferences(),
      browser.storage.local.get(["theme"]),
    ]);
    this.selectedServices = preferences.selectedServices;
    this.visibleServiceOptions = preferences.visibleServiceOptions;
    this.theme = storage.theme === "light" ? "light" : "dark";
    this.syncVisibleResults();
  }

  private resetSession(originalText: string, direction: TranslationDirection): void {
    this.sessionKey = buildTranslationSessionKey(originalText, direction);
    this.cachedResultsByService = {};
    this.results = [];
    this.pendingServices.clear();
  }

  private syncVisibleResults(): void {
    this.results = orderResultsByServices(this.cachedResultsByService, this.selectedServices);
  }

  private applyResults(results: TranslationResultItem[], direction?: TranslationDirection): void {
    if (direction) {
      this.direction = direction;
    }

    this.cachedResultsByService = {
      ...this.cachedResultsByService,
      ...mapResultsByService(decodeResults(results)),
    };
    this.syncVisibleResults();
  }

  private presentDialog(): void {
    const wasClosing = this.closingTimer !== null;
    if (this.closingTimer) {
      clearTimeout(this.closingTimer);
      this.closingTimer = null;
    }
    if (!this.dialog) return;
    if (!this.dialog.open) {
      this.dialog.showModal();
      this.animateIn();
    } else if (wasClosing) {
      this.animateIn();
    }
  }

  private animateIn(): void {
    if (!this.dialog) return;
    this.dialog.style.transform = "scale(.86)";
    this.dialog.style.opacity = "0";
    this.dialog.classList.remove("backdrop-active");
    window.setTimeout(() => {
      if (!this.dialog) return;
      this.dialog.style.transition =
        "transform .35s cubic-bezier(.34,1.56,.64,1), opacity .35s ease-out";
      this.dialog.style.transform = "scale(1)";
      this.dialog.style.opacity = "1";
      this.dialog.classList.add("backdrop-active");
    }, 10);
  }

  private ensureInDocument(): void {
    if (!document.body.contains(this.container)) {
      document.body.appendChild(this.container);
    }
  }

  private closeDialog(): void {
    if (!this.dialog) return;
    this.abortOngoingTranslation();
    this.stopReading();
    if (this.closingTimer) clearTimeout(this.closingTimer);
    this.dialog.style.transition = "transform .15s ease-in, opacity .15s ease-in";
    this.dialog.style.transform = "scale(.86)";
    this.dialog.style.opacity = "0";
    this.dialog.classList.remove("backdrop-active");
    this.closingTimer = window.setTimeout(() => {
      this.dialog?.close();
      this.closingTimer = null;
      this.onClose?.();
    }, 150);
  }

  private abortOngoingTranslation(): void {
    browser.runtime.sendMessage({ action: "abortTranslation" }).catch(() => {});
  }

  private stopReading(): void {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    this.isReadingOriginal = false;
    this.readingResultService = null;
  }

  private isTranslating(): boolean {
    return this.pendingServices.size > 0;
  }

  /**
   * Keeps the in-page dialog aligned with the background cache so provider
   * toggles only fetch missing services and removed cards disappear instantly.
   */
  private async performTranslation(forceRefresh = false): Promise<void> {
    if (this.selectedServices.length === 0) {
      this.status = "error";
      this.errorMessage = "至少选择一个翻译服务";
      this.syncVisibleResults();
      this.render();
      return;
    }

    const currentSessionKey = buildTranslationSessionKey(this.originalText, this.direction);
    const isSameSession = this.sessionKey === currentSessionKey;
    if (!isSameSession || forceRefresh) {
      this.abortOngoingTranslation();
      this.resetSession(this.originalText, this.direction);
      this.stopReading();
    }

    const requestServices =
      forceRefresh || !isSameSession
        ? [...this.selectedServices]
        : this.selectedServices.filter(
            (service) =>
              !this.cachedResultsByService[service] && !this.pendingServices.has(service),
          );

    requestServices.forEach((service) => this.pendingServices.add(service));
    this.errorMessage = "";
    this.isServiceMenuOpen = false;
    if (this.results.length === 0 && this.pendingServices.size > 0) {
      this.status = "loading";
    } else if (this.results.length > 0) {
      this.status = "success";
    }
    this.render();

    try {
      const response = (await browser.runtime.sendMessage({
        action: "translate",
        text: this.originalText,
        services: this.selectedServices,
        direction: this.direction,
        forceRefresh,
      })) as TranslateDialogResponse;

      if (response.success && Array.isArray(response.results)) {
        this.applyResults(response.results, response.direction);
        return;
      }
      if (response.isAbort) return;
      this.errorMessage = response.error || "翻译失败";
      if (this.results.length === 0) {
        this.status = "error";
      }
    } catch (error: unknown) {
      if (isAbortError(error)) return;
      this.errorMessage = "翻译失败，请重试";
      if (this.results.length === 0) {
        this.status = "error";
      }
    } finally {
      requestServices.forEach((service) => this.pendingServices.delete(service));
      this.syncVisibleResults();
      if (this.pendingServices.size > 0 && this.results.length === 0) {
        this.status = "loading";
      } else if (this.results.length > 0) {
        this.status = "success";
      } else if (this.errorMessage) {
        this.status = "error";
      }
      this.render();
    }
  }

  private toggleTheme(): void {
    this.theme = this.theme === "light" ? "dark" : "light";
    void browser.storage.local.set({ theme: this.theme });
    this.render();
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  private renderServiceToggles(): string {
    return this.visibleServiceOptions
      .map((serviceOption) => {
        const active = this.selectedServices.includes(serviceOption.id);
        return `
        <label class="service-option">
          <input type="checkbox" data-service-toggle="${serviceOption.id}" ${active ? "checked" : ""} />
          <span>${this.escapeHtml(serviceOption.label)}</span>
        </label>
      `;
      })
      .join("");
  }

  private renderLoadingIndicator(centered = false): string {
    return `<div class="status-row${centered ? " status-row-centered" : ""}" aria-label="翻译中"><div class="spinner" aria-hidden="true"></div></div>`;
  }

  private renderPendingCard(service: TranslationServiceId): string {
    return `
      <article class="result-card">
        <div class="result-head">
          <div class="badges">
            <span class="badge">${this.escapeHtml(getServiceLabel(service))}</span>
          </div>
        </div>
        ${this.renderLoadingIndicator()}
      </article>
    `;
  }

  private renderResultCards(): string {
    const visibleServices = this.selectedServices.filter(
      (service) => this.cachedResultsByService[service] || this.pendingServices.has(service),
    );

    if (visibleServices.length === 0) {
      if (this.isTranslating()) {
        return this.renderLoadingIndicator(true);
      }
      return `<div class="error-state"><span>✕</span><span>${this.escapeHtml(this.errorMessage || "暂无翻译结果")}</span></div>`;
    }

    return visibleServices
      .map((service) => {
        const result = this.cachedResultsByService[service];
        const pending = this.pendingServices.has(service);

        if (!result) {
          return this.renderPendingCard(service);
        }

        const canInteract = result.status === "success";
        const speaking = this.readingResultService === result.service;
        const body =
          result.status === "success"
            ? `<div class="result-text">${this.escapeHtml(result.translation)}</div>`
            : `<div class="error-state"><span>✕</span><span>${this.escapeHtml(result.error)}</span></div>`;
        return `
          <article class="result-card">
            <div class="result-head">
              <div class="badges">
                <span class="badge">${this.escapeHtml(result.serviceLabel)}</span>
                ${result.status === "error" ? '<span class="badge badge-error">失败</span>' : ""}
                ${pending ? '<span class="badge">更新中</span>' : ""}
              </div>
              <div class="actions">
                <button class="icon-btn" type="button" data-tts-service="${result.service}" title="${speaking ? "停止朗读" : "朗读"}" ${canInteract ? "" : "disabled"}>${speaking ? "⏹" : "🔊"}</button>
                <button class="icon-btn" type="button" data-copy-service="${result.service}" title="复制" ${canInteract ? "" : "disabled"}>📋</button>
              </div>
            </div>
            ${body}
          </article>
        `;
      })
      .join("");
  }

  private async copyToClipboard(text: string, button: HTMLButtonElement): Promise<void> {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      this.shadowRoot.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand("copy");
      this.shadowRoot.removeChild(textArea);
    }
    const original = button.innerHTML;
    button.innerHTML = "✅";
    window.setTimeout(() => {
      button.innerHTML = original;
    }, 2000);
  }

  private render(): void {
    if (!this.dialog) {
      this.shadowRoot.innerHTML = `
        <style>
          :host{--bg:#222;--text:#fff;--sub:rgba(255,255,255,.75);--box1:rgba(255,255,255,.08);--box2:rgba(255,255,255,.12);--btn:rgba(255,255,255,.14);--btn-hover:rgba(255,255,255,.24);--border:rgba(255,255,255,.14);--active:#2563eb;--error:#ff8b8b}
          dialog.light-theme{--bg:#fff;--text:#222;--sub:rgba(0,0,0,.62);--box1:#f3f4f6;--box2:#eef2ff;--btn:rgba(0,0,0,.05);--btn-hover:rgba(0,0,0,.1);--border:rgba(0,0,0,.1);--error:#dc2626}
          dialog{padding:20px;background:var(--bg);color:var(--text);border:none;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.3);max-width:560px;width:min(84vw,560px);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;position:fixed;margin:auto;inset:0;user-select:none;max-height:88vh;overflow:hidden;transition:transform .3s ease,opacity .3s ease;display:none}
          dialog[open]{display:flex;flex-direction:column}dialog.is-positioned{margin:0;inset:auto}dialog.dragging{transition:none!important}dialog.expanded{width:100%!important;height:100%!important;max-width:100%!important;max-height:100vh!important;border-radius:0!important;margin:0!important;inset:0!important;transform:none!important}
          dialog::backdrop{background:rgba(0,0,0,0);transition:background .15s ease-in}dialog.backdrop-active::backdrop{background:rgba(0,0,0,.5);transition:background .35s ease-out}
          .wrap{height:100%;max-height:88vh;display:flex;flex-direction:column;gap:12px;overflow:hidden}.header{display:flex;justify-content:space-between;align-items:center;cursor:move}.title{display:flex;align-items:center;gap:8px}.title h3{margin:0;font-size:18px;font-weight:600}.icon{width:20px;height:20px;border-radius:6px;overflow:hidden;display:flex}.icon svg{width:100%;height:100%}
          .actions,.box-actions,.badges{display:flex;align-items:center;gap:6px}.theme-btn,.expand-btn,.close-btn,.icon-btn,.retry-btn,.dir-btn,.dropdown-trigger{background:var(--btn);color:var(--text);border:1px solid var(--border);border-radius:999px;cursor:pointer;transition:background .2s ease,font-color .2s ease;font:inherit;font-size:13px}.theme-btn,.expand-btn,.close-btn,.icon-btn{width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border:none}.retry-btn,.dir-btn,.dropdown-trigger{padding:4px 10px}.retry-btn{border-radius:8px}.theme-btn:hover,.expand-btn:hover,.close-btn:hover,.icon-btn:hover:not(:disabled),.retry-btn:hover,.dir-btn:hover,.dropdown-trigger:hover,.service-option:hover{background:var(--btn-hover)}.icon-btn:disabled{opacity:.45;cursor:not-allowed}
          .settings{display:flex;justify-content:space-between;flex-wrap:wrap;align-items:center;gap:12px 16px}.setting-item{display:inline-flex;align-items:center;gap:8px;min-width:0}.label{font-size:12px;letter-spacing:1px;text-transform:uppercase;color:var(--sub);display:inline-flex;align-items:center;white-space:nowrap;flex-shrink:0}.row{display:flex;flex-wrap:wrap;gap:6px}.dir-btn.active{background:var(--active);border-color:var(--active);color:#fff}.service-setting{min-width:0}
          .service-dropdown{position:relative;display:inline-block;max-width:min(100%,260px)}.dropdown-trigger{width:auto;max-width:100%;min-width:180px;border-radius:10px;display:flex;align-items:center;justify-content:space-between;gap:8px}.dropdown-trigger-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dropdown-arrow{font-size:12px;transition:transform .2s ease}.dropdown-arrow.open{transform:rotate(180deg)}.dropdown-menu{position:absolute;top:calc(100% + 8px);left:0;right:auto;min-width:100%;width:max-content;max-width:min(320px,calc(92vw - 40px));box-sizing:border-box;padding:8px;border:1px solid var(--border);border-radius:12px;background:var(--bg);box-shadow:0 16px 32px rgba(0,0,0,.24);display:flex;flex-direction:column;gap:4px;z-index:30}.service-option{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:10px;cursor:pointer}.service-option input{margin:0}.service-option span{font-size:13px;color:var(--text)}.service-dropdown-error{padding:4px 10px 2px;color:var(--error);font-size:12px}
          .box{background:var(--box1);padding:14px;border-radius:12px;display:flex;flex-direction:column;min-height:0}.box.original{max-height:24vh;flex-shrink:0}.box.translation{background:var(--box2);flex:1}.box-head{font-size:12px;color:var(--sub);margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:12px}.box-head strong{color:var(--text);font-size:14px}.text,.results{overflow-y:auto;min-height:0}.text{font-size:15px;line-height:1.6;user-select:text;word-break:break-word}.original-text{min-height:1.6em}.results{display:flex;flex-direction:column;gap:12px}
          .result-card{background:rgba(255,255,255,.08);border:1px solid var(--border);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px}.result-head{display:flex;justify-content:space-between;align-items:center;gap:10px}.badge{display:inline-flex;align-items:center;border-radius:999px;padding:2.5px 10px;font-size:12px;font-weight:600;background:var(--btn)}.badge-error{color:var(--error);background:color-mix(in srgb,var(--error),transparent 82%)}.result-text,.error-state{font-size:15px;line-height:1.6;word-break:break-word}.error-state{color:var(--error);display:flex;gap:8px;align-items:flex-start}.status-row{display:flex;align-items:center;gap:10px;padding:12px 0;color:var(--sub);font-size:14px}.status-row-centered{justify-content:center}.spinner{width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--active);border-radius:50%;animation:spin .8s linear infinite}
          .text::-webkit-scrollbar,.results::-webkit-scrollbar{width:6px}.text::-webkit-scrollbar-thumb,.results::-webkit-scrollbar-thumb{background:rgba(127,127,127,.35);border-radius:3px}
          @keyframes spin{to{transform:rotate(360deg)}}
        </style>
        <dialog id="translation-dialog"><div id="dialog-inner-content"></div></dialog>
      `;
      this.dialog = this.shadowRoot.getElementById("translation-dialog") as HTMLDialogElement;
    }
    if (this.theme === "light") this.dialog.classList.add("light-theme");
    else this.dialog.classList.remove("light-theme");
    if (this.isDialogExpanded) this.dialog.classList.add("expanded");
    else this.dialog.classList.remove("expanded");
    const innerContent = this.shadowRoot.getElementById("dialog-inner-content");
    if (!innerContent) return;
    innerContent.innerHTML = `
      <div class="wrap">
        <div class="header">
          <div class="title"><div class="icon">${iconSvg}</div><h3>${this.status === "error" && this.results.length === 0 ? "翻译失败" : "中英直译"}</h3></div>
          <div class="actions">
            <button class="theme-btn" id="theme-btn" title="切换主题">${this.theme === "dark" ? "🌙" : "☀️"}</button>
            <button class="expand-btn" id="expand-btn" title="${this.isDialogExpanded ? "还原" : "全屏"}">${this.isDialogExpanded ? "⇲" : "⤢"}</button>
            <button class="close-btn" id="close-btn" title="关闭">×</button>
          </div>
        </div>
        <div class="settings">
          <div class="setting-item">
            <span class="label">翻译目标</span>
            <div class="row"><button class="dir-btn ${this.direction === "en" ? "active" : ""}" type="button" data-direction="en">到英文</button><button class="dir-btn ${this.direction === "zh" ? "active" : ""}" type="button" data-direction="zh">到中文</button></div>
          </div>
          <div class="setting-item service-setting">
            <span class="label">翻译服务</span>
            <div class="service-dropdown">
              <button class="dropdown-trigger" id="service-dropdown-trigger" type="button">
                <span class="dropdown-trigger-text">${this.escapeHtml(
                  getSelectedServicesSummary(this.selectedServices),
                )}</span>
                <span class="dropdown-arrow ${this.isServiceMenuOpen ? "open" : ""}">▼</span>
              </button>
              ${
                this.isServiceMenuOpen
                  ? `<div class="dropdown-menu">${this.renderServiceToggles()}${
                      this.selectedServices.length === 0
                        ? '<div class="service-dropdown-error">至少选择一个翻译服务</div>'
                        : ""
                    }</div>`
                  : ""
              }
            </div>
          </div>
        </div>
        <section class="box original">
          <div class="box-head"><strong>原文</strong><div class="box-actions"><button class="icon-btn" id="tts-btn" title="${this.isReadingOriginal ? "停止朗读" : "朗读原文"}">${this.isReadingOriginal ? "⏹" : "🔊"}</button><button class="icon-btn" id="youdao-btn" title="在有道词典中查看">↗</button></div></div>
          <div class="text original-text">${this.escapeHtml(this.originalText)}</div>
        </section>
        <section class="box translation">
          <div class="box-head"><div class="badges"><strong>翻译结果</strong>${this.results.length > 0 ? `<span>${this.results.length} 个服务</span>` : ""}</div><div class="box-actions"><button class="retry-btn" id="retry-btn" type="button">重新翻译</button></div></div>
          <div class="results">${this.renderResultCards()}</div>
        </section>
      </div>
    `;
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    if (!this.dialog) return;
    const wrap = this.shadowRoot.querySelector(".wrap") as HTMLElement | null;
    if (wrap)
      wrap.onclick = (event) => {
        const target = event.target as HTMLElement;
        if (this.isServiceMenuOpen && !target.closest(".service-dropdown")) {
          this.isServiceMenuOpen = false;
          this.render();
        }
      };
    const expandButton = this.shadowRoot.getElementById("expand-btn");
    if (expandButton)
      expandButton.onclick = (event) => {
        event.stopPropagation();
        this.isDialogExpanded = !this.isDialogExpanded;
        this.dialog?.classList.remove("is-positioned");
        if (this.dialog) {
          this.dialog.style.left = "";
          this.dialog.style.top = "";
        }
        this.render();
      };
    const themeButton = this.shadowRoot.getElementById("theme-btn");
    if (themeButton)
      themeButton.onclick = (event) => {
        event.stopPropagation();
        this.isServiceMenuOpen = false;
        this.toggleTheme();
      };
    const closeButton = this.shadowRoot.getElementById("close-btn");
    if (closeButton)
      closeButton.onclick = (event) => {
        event.stopPropagation();
        this.isServiceMenuOpen = false;
        this.closeDialog();
      };
    const serviceDropdownTrigger = this.shadowRoot.getElementById("service-dropdown-trigger");
    if (serviceDropdownTrigger)
      serviceDropdownTrigger.onclick = (event) => {
        event.stopPropagation();
        this.isServiceMenuOpen = !this.isServiceMenuOpen;
        this.render();
      };
    const header = this.shadowRoot.querySelector(".header") as HTMLElement | null;
    if (header) {
      header.onmousedown = (event: MouseEvent) => {
        if (this.isDialogExpanded || !this.dialog) return;
        if ((event.target as HTMLElement).closest("button")) return;
        let moved = false;
        const rect = this.dialog.getBoundingClientRect();
        this.dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        const onMouseMove = (moveEvent: MouseEvent) => {
          if (!this.dialog) return;
          if (!moved) {
            moved = true;
            this.dialog.classList.add("dragging", "is-positioned");
          }
          const nextX = Math.max(
            0,
            Math.min(moveEvent.clientX - this.dragOffset.x, window.innerWidth - rect.width),
          );
          const nextY = Math.max(
            0,
            Math.min(moveEvent.clientY - this.dragOffset.y, window.innerHeight - rect.height),
          );
          this.dialog.style.left = `${nextX}px`;
          this.dialog.style.top = `${nextY}px`;
        };
        const onMouseUp = () => {
          this.dialog?.classList.remove("dragging");
          window.removeEventListener("mousemove", onMouseMove);
          window.removeEventListener("mouseup", onMouseUp);
        };
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
      };
    }
    this.dialog.onclick = (event) => {
      if (event.target === this.dialog) this.closeDialog();
    };
    this.dialog.oncancel = (event) => {
      event.preventDefault();
      this.closeDialog();
    };
    this.shadowRoot.querySelectorAll<HTMLElement>("[data-direction]").forEach((button) => {
      button.onclick = (event) => {
        const newDirection = (event.currentTarget as HTMLElement).getAttribute("data-direction");
        if (newDirection === "zh" || newDirection === "en") {
          if (newDirection !== this.direction) {
            this.isServiceMenuOpen = false;
            this.direction = newDirection;
            void this.performTranslation(true);
          }
        }
      };
    });
    this.shadowRoot.querySelectorAll<HTMLInputElement>("[data-service-toggle]").forEach((input) => {
      input.onchange = async (event) => {
        event.stopPropagation();
        const service = (event.currentTarget as HTMLInputElement).getAttribute(
          "data-service-toggle",
        );
        if (!service || !isTranslationServiceId(service)) return;
        const nextServices = this.selectedServices.includes(service)
          ? this.selectedServices.filter((item) => item !== service)
          : [...this.selectedServices, service];
        this.selectedServices = nextServices;
        await persistSelectedServices(nextServices);

        if (!nextServices.includes(service) && this.readingResultService === service) {
          this.stopReading();
        }

        if (!nextServices.includes(service)) {
          this.pendingServices.delete(service);
        }

        this.syncVisibleResults();
        if (nextServices.length === 0) {
          this.status = "error";
          this.errorMessage = "至少选择一个翻译服务";
          this.render();
          return;
        }
        this.errorMessage = "";
        this.render();
        void this.performTranslation(false);
      };
    });
    const retryButton = this.shadowRoot.getElementById("retry-btn");
    if (retryButton)
      retryButton.onclick = (event) => {
        event.stopPropagation();
        void this.performTranslation(true);
      };
    const youdaoButton = this.shadowRoot.getElementById("youdao-btn");
    if (youdaoButton)
      youdaoButton.onclick = () => {
        window.open(
          `https://www.youdao.com/result?word=${encodeURIComponent(this.originalText)}&lang=en`,
          "_blank",
        );
      };
    const originalTtsButton = this.shadowRoot.getElementById("tts-btn");
    if (originalTtsButton)
      originalTtsButton.onclick = () => {
        if (this.isReadingOriginal) {
          window.speechSynthesis.cancel();
          this.isReadingOriginal = false;
          this.readingResultService = null;
          this.render();
          return;
        }
        window.speechSynthesis.cancel();
        this.readingResultService = null;
        const utterance = new SpeechSynthesisUtterance(this.originalText);
        utterance.lang = this.direction === "zh" ? "en-US" : "zh-CN";
        utterance.onstart = () => {
          this.isReadingOriginal = true;
          this.render();
        };
        utterance.onend = () => {
          this.isReadingOriginal = false;
          this.render();
        };
        utterance.onerror = () => {
          this.isReadingOriginal = false;
          this.render();
        };
        window.speechSynthesis.speak(utterance);
      };
    this.shadowRoot.querySelectorAll<HTMLElement>("[data-copy-service]").forEach((button) => {
      button.onclick = () => {
        const service = button.getAttribute("data-copy-service");
        if (!service || !isTranslationServiceId(service)) return;
        const result = this.results.find((item) => item.service === service);
        if (result?.status === "success") {
          void this.copyToClipboard(result.translation, button as HTMLButtonElement);
        }
      };
    });
    this.shadowRoot.querySelectorAll<HTMLElement>("[data-tts-service]").forEach((button) => {
      button.onclick = () => {
        const service = button.getAttribute("data-tts-service");
        if (!service || !isTranslationServiceId(service)) return;
        const result = this.results.find((item) => item.service === service);
        if (!result || result.status !== "success") return;
        if (this.readingResultService === service) {
          window.speechSynthesis.cancel();
          this.readingResultService = null;
          this.render();
          return;
        }
        window.speechSynthesis.cancel();
        this.isReadingOriginal = false;
        const utterance = new SpeechSynthesisUtterance(result.translation);
        utterance.lang = result.direction === "zh" ? "zh-CN" : "en-US";
        utterance.onstart = () => {
          this.readingResultService = service;
          this.render();
        };
        utterance.onend = () => {
          this.readingResultService = null;
          this.render();
        };
        utterance.onerror = () => {
          this.readingResultService = null;
          this.render();
        };
        window.speechSynthesis.speak(utterance);
      };
    });
  }
}
