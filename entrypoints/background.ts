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

interface TabTranslationState {
  text: string;
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

    return tabSelections.get(tabId) ?? createEmptyTabState();
  };

  const getTabControllers = (tabId: number): Map<TranslationServiceId, AbortController> => {
    if (!tabControllers.has(tabId)) {
      tabControllers.set(tabId, new Map());
    }

    return tabControllers.get(tabId) ?? new Map();
  };

  const getTabPendingPromises = (
    tabId: number,
  ): Map<TranslationServiceId, Promise<TranslationResultItem>> => {
    if (!tabPendingPromises.has(tabId)) {
      tabPendingPromises.set(tabId, new Map());
    }

    return tabPendingPromises.get(tabId) ?? new Map();
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

  const createTabSessionState = (
    text: string,
    direction: TranslationDirection,
    selectedServices: TranslationServiceId[],
  ): TabTranslationState => ({
    text,
    timestamp: Date.now(),
    success: false,
    direction,
    selectedServices,
    pendingServices: [],
    cachedResultsByService: {},
  });

  const mergeTabResults = (
    tabId: number,
    text: string,
    direction: TranslationDirection,
    results: TranslationResultItem[],
  ): void => {
    const state = getTabSelection(tabId);

    if (state.text !== text || state.direction !== direction) {
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
    text: string,
    services?: TranslationServiceId[],
    direction?: TranslationDirection,
    forceRefresh = false,
    preserveSelection = false,
    notifyIncremental = false,
  ): Promise<TranslationBatchResult> => {
    const requestedServices = await resolveRequestedServices(services);
    const finalDirection = direction ?? detectDirection(text);

    if (requestedServices.length === 0) {
      throw new Error("至少选择一个翻译服务");
    }

    const currentState = getTabSelection(tabId);
    const sameSession = currentState.text === text && currentState.direction === finalDirection;

    if (!sameSession) {
      abortTabTranslations(tabId);
      tabSelections.set(tabId, createTabSessionState(text, finalDirection, requestedServices));
    } else {
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

      const requestPromise = translateWithService(text, service, finalDirection, controller.signal)
        .then((result) => {
          mergeTabResults(tabId, text, finalDirection, [result]);

          // 增量通知 UI: 每个服务完成后立即发送更新
          if (notifyIncremental) {
            const latestState = getTabSelection(tabId);
            if (latestState.text === text && latestState.direction === finalDirection) {
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
        selectedText,
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

      const translationPromise =
        typeof tabId === "number"
          ? requestTabTranslations(
              tabId,
              text,
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

    if (action === "updateMenuTitle" && typeof runtimeMessage.text === "string") {
      if (typeof tabId === "number") {
        const current = getTabSelection(tabId);
        if (current.text !== runtimeMessage.text) {
          abortTabTranslations(tabId);
          tabSelections.set(tabId, {
            ...createEmptyTabState(),
            text: runtimeMessage.text,
            direction: detectDirection(runtimeMessage.text),
            selectedServices: current.selectedServices,
          });
        }
      }

      browser.contextMenus
        .update("translate-selection", { title: getContextMenuTitle(runtimeMessage.text) })
        .then(() => sendResponse({ success: true }))
        .catch(() => sendResponse({ success: false }));
      return true;
    }

    if (action === "resetMenuTitle") {
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
    const textToTranslate = info.selectionText?.trim() || currentSelection.text;

    if (!textToTranslate) {
      browser.tabs
        .sendMessage(tabId, { action: "showErrorDialog", message: "请先选中文本" })
        .catch(() => {});
      return;
    }

    void (async () => {
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
            originalText: textToTranslate,
            results: cachedResults,
            direction,
          })
          .catch(() => {});
      } else {
        browser.tabs
          .sendMessage(tabId, { action: "showLoadingDialog", originalText: textToTranslate })
          .catch(() => {});
      }

      requestTabTranslations(
        tabId,
        textToTranslate,
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
