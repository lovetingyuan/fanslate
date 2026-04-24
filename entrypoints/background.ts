import {
  detectDirection,
  getSelectedServices,
  isAbortError,
  isTranslationServiceId,
  mapResultsByService,
  orderResultsByServices,
  translateWithService,
  translateWithServices,
  type TranslationBatchResult,
  type TranslationDirection,
  type TranslationResultItem,
  type TranslationResultsByService,
  type TranslationServiceId,
} from "../utils/translation";
import {
  buildTranslationSourceKey,
  chooseSelectionSource,
  createPlainTextSource,
  normalizeTranslationSourcePayload,
  type TranslationSourcePayload,
} from "../utils/richText";

interface TabTranslationState {
  text: string;
  source: TranslationSourcePayload | null;
  sourceKey: string;
  timestamp: number;
  success: boolean;
  direction: TranslationDirection;
  selectedServices: TranslationServiceId[];
  pendingServices: TranslationServiceId[];
  cachedResultsByService: TranslationResultsByService;
}

interface RuntimeMessageShape {
  action?: unknown;
  text?: unknown;
  source?: unknown;
  selection?: unknown;
  services?: unknown;
  direction?: unknown;
  forceRefresh?: unknown;
  preserveSelection?: unknown;
}

type ContextMenusWithOnShown = typeof browser.contextMenus & {
  onShown: {
    addListener: (
      callback: (info: { selectionText?: string }, tab?: { id?: number }) => void,
    ) => void;
  };
  refresh?: () => Promise<void> | void;
};

const CONTEXT_MENU_DEFAULT_TITLE = "翻译";
const CONTEXT_MENU_PREVIEW_LIMIT = 30;
const CONTEXT_MENU_PREFETCH_LIMIT = 200;

const createEmptyTabState = (): TabTranslationState => ({
  text: "",
  source: null,
  sourceKey: "",
  timestamp: 0,
  success: false,
  direction: "zh",
  selectedServices: [],
  pendingServices: [],
  cachedResultsByService: {},
});

const hasSuccessfulResults = (resultsByService: TranslationResultsByService): boolean => {
  return Object.values(resultsByService).some((result) => result?.status === "success");
};

const normalizeRequestedServices = (value: unknown): TranslationServiceId[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter(isTranslationServiceId);
};

const normalizeRequestedDirection = (value: unknown): TranslationDirection | undefined => {
  return value === "zh" || value === "en" ? value : undefined;
};

/**
 * Context menu labels are rendered by the host browser, so we collapse
 * whitespace before truncating to avoid blank labels caused by embedded
 * newlines or tabs in the selected text.
 */
const getContextMenuTitle = (text?: string): string => {
  const normalizedText = text?.replace(/\s+/g, " ").trim() ?? "";

  if (!normalizedText) {
    return CONTEXT_MENU_DEFAULT_TITLE;
  }

  return normalizedText.length > CONTEXT_MENU_PREVIEW_LIMIT
    ? `翻译: ${normalizedText.slice(0, CONTEXT_MENU_PREVIEW_LIMIT - 3)}...`
    : `翻译: ${normalizedText}`;
};

export default defineBackground(() => {
  const tabSelections = new Map<number, TabTranslationState>();
  const tabControllers = new Map<number, Map<TranslationServiceId, AbortController>>();
  const tabPendingPromises = new Map<
    number,
    Map<TranslationServiceId, Promise<TranslationResultItem>>
  >();

  const ensureContextMenu = async (): Promise<void> => {
    try {
      await browser.contextMenus.removeAll();
      await browser.contextMenus.create({
        id: "translate-selection",
        title: CONTEXT_MENU_DEFAULT_TITLE,
        contexts: ["selection"],
        documentUrlPatterns: ["http://*/*", "https://*/*"],
      });
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Failed to initialize context menu:", error);
      }
    }
  };

  browser.runtime.onInstalled.addListener(() => {
    void ensureContextMenu();
  });
  void ensureContextMenu();

  const getTabSelection = (tabId: number): TabTranslationState => {
    if (!tabSelections.has(tabId)) {
      tabSelections.set(tabId, createEmptyTabState());
    }

    return tabSelections.get(tabId)!;
  };

  const getTabControllers = (tabId: number): Map<TranslationServiceId, AbortController> => {
    if (!tabControllers.has(tabId)) {
      tabControllers.set(tabId, new Map());
    }

    return tabControllers.get(tabId)!;
  };

  const getTabPendingPromises = (
    tabId: number,
  ): Map<TranslationServiceId, Promise<TranslationResultItem>> => {
    if (!tabPendingPromises.has(tabId)) {
      tabPendingPromises.set(tabId, new Map());
    }

    return tabPendingPromises.get(tabId)!;
  };

  const syncPendingServices = (tabId: number): void => {
    const state = getTabSelection(tabId);
    state.pendingServices = Array.from(getTabPendingPromises(tabId).keys());
  };

  const pruneTabRequestState = (tabId: number): void => {
    if (getTabControllers(tabId).size === 0) {
      tabControllers.delete(tabId);
    }

    if (getTabPendingPromises(tabId).size === 0) {
      tabPendingPromises.delete(tabId);
    }
  };

  const abortTabTranslations = (tabId: number, services?: TranslationServiceId[]): void => {
    const controllerMap = getTabControllers(tabId);
    const pendingMap = getTabPendingPromises(tabId);
    const servicesToAbort = services ?? Array.from(controllerMap.keys());

    servicesToAbort.forEach((service) => {
      controllerMap.get(service)?.abort();
      controllerMap.delete(service);
      pendingMap.delete(service);
    });

    syncPendingServices(tabId);
    pruneTabRequestState(tabId);
  };

  const clearTabState = (tabId: number): void => {
    abortTabTranslations(tabId);
    tabSelections.delete(tabId);
    tabControllers.delete(tabId);
    tabPendingPromises.delete(tabId);
  };

  /**
   * Keeps the background cache aligned with the currently selected providers so
   * reopening the page dialog can instantly restore only the visible cards.
   */
  const getVisibleResults = (
    state: TabTranslationState,
    services: TranslationServiceId[] = state.selectedServices,
  ): TranslationResultItem[] => {
    return orderResultsByServices(state.cachedResultsByService, services);
  };

  const resolveTabSource = (tabId: number, text: string): TranslationSourcePayload => {
    const currentState = getTabSelection(tabId);
    return chooseSelectionSource({
      liveSource: null,
      cachedSource: currentState.text === text ? currentState.source : null,
      fallbackText: text,
    });
  };

  const requestLiveSelectionSource = async (
    tabId: number,
    fallbackText: string,
  ): Promise<TranslationSourcePayload> => {
    const currentState = getTabSelection(tabId);

    try {
      const response = (await browser.tabs.sendMessage(tabId, {
        action: "getSelectionPayload",
      })) as { selection?: unknown; success?: boolean } | undefined;

      const liveSource = normalizeTranslationSourcePayload(response?.selection);
      return chooseSelectionSource({
        liveSource,
        cachedSource: currentState.text === fallbackText ? currentState.source : null,
        fallbackText,
      });
    } catch {
      return chooseSelectionSource({
        liveSource: null,
        cachedSource: currentState.text === fallbackText ? currentState.source : null,
        fallbackText,
      });
    }
  };

  const createTabSessionState = (
    source: TranslationSourcePayload,
    direction: TranslationDirection,
    selectedServices: TranslationServiceId[],
  ): TabTranslationState => ({
    text: source.plainText,
    source,
    sourceKey: buildTranslationSourceKey(source),
    timestamp: Date.now(),
    success: false,
    direction,
    selectedServices,
    pendingServices: [],
    cachedResultsByService: {},
  });

  const mergeTabResults = (
    tabId: number,
    source: TranslationSourcePayload,
    direction: TranslationDirection,
    results: TranslationResultItem[],
  ): void => {
    const state = getTabSelection(tabId);

    if (
      state.text !== source.plainText ||
      state.sourceKey !== buildTranslationSourceKey(source) ||
      state.direction !== direction
    ) {
      return;
    }

    state.cachedResultsByService = {
      ...state.cachedResultsByService,
      ...mapResultsByService(results),
    };
    state.timestamp = Date.now();
    state.success = hasSuccessfulResults(state.cachedResultsByService);
  };

  const resolveRequestedServices = async (
    services?: TranslationServiceId[],
  ): Promise<TranslationServiceId[]> => {
    return services && services.length > 0 ? services : await getSelectedServices();
  };

  const requestTabTranslations = async (
    tabId: number,
    source: TranslationSourcePayload,
    services?: TranslationServiceId[],
    direction?: TranslationDirection,
    forceRefresh = false,
    preserveSelection = false,
    notifyIncremental = false,
  ): Promise<TranslationBatchResult> => {
    const requestedServices = await resolveRequestedServices(services);
    const finalDirection = direction ?? detectDirection(source.plainText);
    const sourceKey = buildTranslationSourceKey(source);

    if (requestedServices.length === 0) {
      throw new Error("至少选择一个翻译服务");
    }

    const currentState = getTabSelection(tabId);
    const sameSession =
      currentState.text === source.plainText &&
      currentState.sourceKey === sourceKey &&
      currentState.direction === finalDirection;

    if (!sameSession) {
      abortTabTranslations(tabId);
      tabSelections.set(tabId, createTabSessionState(source, finalDirection, requestedServices));
    } else {
      currentState.source = source;
      currentState.sourceKey = sourceKey;
      currentState.selectedServices =
        preserveSelection && currentState.selectedServices.length > 0
          ? currentState.selectedServices
          : requestedServices;

      if (forceRefresh) {
        abortTabTranslations(tabId, requestedServices);

        const nextCachedResultsByService = { ...currentState.cachedResultsByService };
        requestedServices.forEach((service) => {
          delete nextCachedResultsByService[service];
        });
        currentState.cachedResultsByService = nextCachedResultsByService;
        currentState.timestamp = Date.now();
        currentState.success = hasSuccessfulResults(nextCachedResultsByService);
      }
    }

    const state = getTabSelection(tabId);
    const controllerMap = getTabControllers(tabId);
    const pendingMap = getTabPendingPromises(tabId);

    const resultPromises = requestedServices.map((service) => {
      const cachedResult = state.cachedResultsByService[service];
      if (cachedResult) {
        return Promise.resolve(cachedResult);
      }

      const pendingPromise = pendingMap.get(service);
      if (pendingPromise) {
        return pendingPromise;
      }

      const controller = new AbortController();
      controllerMap.set(service, controller);

      const requestPromise = translateWithService(
        source,
        service,
        finalDirection,
        controller.signal,
      )
        .then((result) => {
          mergeTabResults(tabId, source, finalDirection, [result]);

          // 增量通知 UI: 每个服务完成后立即发送更新
          if (notifyIncremental) {
            const latestState = getTabSelection(tabId);
            if (
              latestState.text === source.plainText &&
              latestState.sourceKey === sourceKey &&
              latestState.direction === finalDirection
            ) {
              browser.tabs
                .sendMessage(tabId, {
                  action: "updateDetailDialog",
                  results: getVisibleResults(latestState),
                  direction: finalDirection,
                })
                .catch(() => {});
            }
          }

          return result;
        })
        .finally(() => {
          const latestControllers = getTabControllers(tabId);
          if (latestControllers.get(service)?.signal === controller.signal) {
            latestControllers.delete(service);
          }

          const latestPending = getTabPendingPromises(tabId);
          if (latestPending.get(service) === requestPromise) {
            latestPending.delete(service);
          }

          syncPendingServices(tabId);
          pruneTabRequestState(tabId);
        });

      pendingMap.set(service, requestPromise);
      syncPendingServices(tabId);
      return requestPromise;
    });

    await Promise.all(resultPromises);

    const latestState = getTabSelection(tabId);
    latestState.source = source;
    latestState.sourceKey = sourceKey;
    latestState.selectedServices =
      preserveSelection && latestState.selectedServices.length > 0
        ? latestState.selectedServices
        : requestedServices;
    latestState.timestamp = Date.now();
    latestState.success = hasSuccessfulResults(latestState.cachedResultsByService);

    return {
      results: getVisibleResults(latestState),
      direction: finalDirection,
    };
  };

  browser.tabs.onRemoved.addListener((tabId) => {
    clearTabState(tabId);
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "loading") {
      clearTabState(tabId);
    }
  });

  browser.tabs.onActivated.addListener(({ tabId }) => {
    const selection = tabSelections.get(tabId);
    if (selection?.text) {
      browser.contextMenus
        .update("translate-selection", { title: getContextMenuTitle(selection.text) })
        .catch(() => {});
    } else {
      browser.contextMenus
        .update("translate-selection", { title: CONTEXT_MENU_DEFAULT_TITLE })
        .catch(() => {});
    }
  });

  if ("onShown" in browser.contextMenus) {
    const contextMenusWithOnShown = browser.contextMenus as ContextMenusWithOnShown;

    contextMenusWithOnShown.onShown.addListener((info, tab) => {
      const selectedText = info.selectionText?.trim();
      const tabId = tab?.id;

      if (!selectedText || selectedText.length === 0) {
        return;
      }

      browser.contextMenus
        .update("translate-selection", { title: getContextMenuTitle(selectedText) })
        .then(() => contextMenusWithOnShown.refresh?.())
        .catch(() => {});

      if (typeof tabId !== "number") {
        return;
      }

      if (selectedText.length >= CONTEXT_MENU_PREFETCH_LIMIT) {
        return;
      }

      const currentSelection = getTabSelection(tabId);
      if (
        currentSelection.text === selectedText &&
        currentSelection.success &&
        getVisibleResults(currentSelection).length > 0
      ) {
        return;
      }

      void requestTabTranslations(
        tabId,
        resolveTabSource(tabId, selectedText),
        undefined,
        undefined,
        false,
        false,
        false,
      ).catch(() => {});
    });
  }

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const runtimeMessage =
      typeof message === "object" && message !== null ? (message as RuntimeMessageShape) : {};
    const action = runtimeMessage.action;
    const tabId = sender.tab?.id;

    if (action === "translate") {
      const text = typeof runtimeMessage.text === "string" ? runtimeMessage.text : "";
      const services = normalizeRequestedServices(runtimeMessage.services);
      const direction = normalizeRequestedDirection(runtimeMessage.direction);
      const forceRefresh = runtimeMessage.forceRefresh === true;
      const preserveSelection = runtimeMessage.preserveSelection === true;

      if (direction) {
        browser.storage.local.set({ translationDirection: direction }).catch(() => {});
      }

      // Prefer the source payload sent by the dialog (preserves HTML context on force-refresh)
      // over the cached tab source, which may have been cleared.
      const incomingSource = normalizeTranslationSourcePayload(runtimeMessage.source);

      const translationPromise =
        typeof tabId === "number"
          ? requestTabTranslations(
              tabId,
              incomingSource ?? resolveTabSource(tabId, text),
              services,
              direction,
              forceRefresh,
              preserveSelection,
            )
          : translateWithServices(text, services, direction);

      translationPromise
        .then((result) => {
          sendResponse({ success: true, results: result.results, direction: result.direction });
        })
        .catch((error: unknown) => {
          if (isAbortError(error)) {
            sendResponse({ success: false, error: "Aborted", isAbort: true });
            return;
          }

          const messageText = error instanceof Error ? error.message : "翻译失败";
          sendResponse({ success: false, error: messageText });
        });
      return true;
    }

    if (action === "abortTranslation") {
      if (typeof tabId === "number") {
        abortTabTranslations(tabId);
      }
      sendResponse({ success: true });
      return true;
    }

    if (action === "getLatestTranslation") {
      if (typeof tabId === "number") {
        const selection = getTabSelection(tabId);
        sendResponse({ ...selection, results: getVisibleResults(selection) });
        return false;
      } else {
        browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
          const activeTabId = tabs[0]?.id;
          if (typeof activeTabId === "number") {
            const selection = getTabSelection(activeTabId);
            sendResponse({ ...selection, results: getVisibleResults(selection) });
          } else {
            sendResponse(null);
          }
        });
        return true;
      }
    }

    if (action === "updateSelectionPayload") {
      const selection = normalizeTranslationSourcePayload(runtimeMessage.selection);

      if (!selection) {
        sendResponse({ success: false });
        return false;
      }

      if (typeof tabId === "number") {
        const current = getTabSelection(tabId);
        if (
          current.text !== selection.plainText ||
          current.sourceKey !== buildTranslationSourceKey(selection)
        ) {
          abortTabTranslations(tabId);
          tabSelections.set(tabId, {
            ...createEmptyTabState(),
            text: selection.plainText,
            source: selection,
            sourceKey: buildTranslationSourceKey(selection),
            direction: detectDirection(selection.plainText),
            selectedServices: current.selectedServices,
          });
        } else {
          current.source = selection;
          current.sourceKey = buildTranslationSourceKey(selection);
        }
      }

      browser.contextMenus
        .update("translate-selection", { title: getContextMenuTitle(selection.plainText) })
        .then(() => sendResponse({ success: true }))
        .catch(() => sendResponse({ success: false }));
      return true;
    }

    if (action === "clearSelectionPayload") {
      browser.contextMenus
        .update("translate-selection", { title: CONTEXT_MENU_DEFAULT_TITLE })
        .then(() => sendResponse({ success: true }))
        .catch(() => sendResponse({ success: false }));
      return true;
    }

    return false;
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== "translate-selection" || typeof tab?.id !== "number") {
      return;
    }

    const tabId = tab.id;
    const currentSelection = getTabSelection(tabId);
    const fallbackText = info.selectionText?.trim() || currentSelection.text;

    if (!fallbackText) {
      browser.tabs
        .sendMessage(tabId, { action: "showErrorDialog", message: "请先选中文本" })
        .catch(() => {});
      return;
    }

    void (async () => {
      const sourceToTranslate = await requestLiveSelectionSource(tabId, fallbackText);
      const textToTranslate = sourceToTranslate.plainText;
      const selectedServices = await getSelectedServices();
      const direction =
        currentSelection.text === textToTranslate
          ? currentSelection.direction
          : detectDirection(textToTranslate);
      const cachedResults =
        currentSelection.text === textToTranslate
          ? getVisibleResults(currentSelection, selectedServices)
          : [];

      if (cachedResults.length > 0) {
        browser.tabs
          .sendMessage(tabId, {
            action: "showDetailDialog",
            source: sourceToTranslate,
            results: cachedResults,
            direction,
          })
          .catch(() => {});
      } else {
        browser.tabs
          .sendMessage(tabId, { action: "showLoadingDialog", source: sourceToTranslate })
          .catch(() => {});
      }

      requestTabTranslations(
        tabId,
        sourceToTranslate,
        selectedServices,
        direction,
        false,
        false,
        true,
      )
        .then((result) => {
          browser.tabs
            .sendMessage(tabId, {
              action: "updateDetailDialog",
              results: result.results,
              direction: result.direction,
            })
            .catch(() => {});
        })
        .catch((error: unknown) => {
          if (isAbortError(error)) {
            return;
          }

          tabSelections.set(tabId, {
            ...createEmptyTabState(),
            text: textToTranslate,
            source: sourceToTranslate,
            sourceKey: buildTranslationSourceKey(sourceToTranslate),
            direction,
            selectedServices,
          });

          const messageText = error instanceof Error ? error.message : "翻译失败，请稍后重试";
          browser.tabs
            .sendMessage(tabId, {
              action: "updateDetailDialogError",
              message: messageText,
            })
            .catch(() => {});
        });
    })().catch(() => {});
  });
});
