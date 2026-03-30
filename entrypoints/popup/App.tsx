import { useEffect, useRef, useState } from "react";
import Settings from "./Settings";
import {
  CheckIcon,
  CopyIcon,
  ErrorIcon,
  GithubIcon,
  MoonIcon,
  RetryIcon,
  SettingsIcon,
  SpeakerIcon,
  StopIcon,
  SunIcon,
} from "../components/icons";
import {
  buildTranslationSessionKey,
  getServiceLabel,
  getSelectedServicesSummary,
  getTranslationServicePreferences,
  isAbortError,
  mapResultsByService,
  orderResultsByServices,
  setSelectedServices as persistSelectedServices,
  type TranslationServiceOption,
  translateWithService,
  type TranslationDirection,
  type TranslationResultItem,
  type TranslationResultsByService,
  type TranslationServiceId,
} from "../../utils/translation";

type PopupTheme = "light" | "dracula";

interface PopupTranslationSession {
  sessionKey: string;
  text: string;
  direction: TranslationDirection;
  cachedResultsByService: TranslationResultsByService;
}

const decodeHtmlEntities = (text: string): string => {
  const doc = new DOMParser().parseFromString(text, "text/html");
  return doc.documentElement.textContent || text;
};

const decodeResults = (results: TranslationResultItem[]): TranslationResultItem[] => {
  return results.map((result) =>
    result.status === "success"
      ? {
          ...result,
          translation: decodeHtmlEntities(result.translation),
        }
      : result,
  );
};

function App() {
  const [inputText, setInputText] = useState("");
  const [results, setResults] = useState<TranslationResultItem[]>([]);
  const [targetLang, setTargetLang] = useState<TranslationDirection>("en");
  const [error, setError] = useState("");
  const [copiedService, setCopiedService] = useState<TranslationServiceId | null>(null);
  const [speakingService, setSpeakingService] = useState<TranslationServiceId | null>(null);
  const [selectedServices, setSelectedServices] = useState<TranslationServiceId[]>([]);
  const [visibleServiceOptions, setVisibleServiceOptions] = useState<TranslationServiceOption[]>(
    [],
  );
  const [pendingServices, setPendingServices] = useState<TranslationServiceId[]>([]);
  const [theme, setTheme] = useState<PopupTheme>("light");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isServiceMenuOpen, setIsServiceMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const serviceMenuRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<PopupTranslationSession | null>(null);
  const selectedServicesRef = useRef<TranslationServiceId[]>([]);
  const requestControllersRef = useRef<Map<TranslationServiceId, AbortController>>(new Map());
  const requestPromisesRef = useRef<Map<TranslationServiceId, Promise<TranslationResultItem>>>(
    new Map(),
  );
  const pendingServicesRef = useRef<Set<TranslationServiceId>>(new Set());

  const isLoading = pendingServices.length > 0;

  const refreshServicePreferences = async () => {
    const preferences = await getTranslationServicePreferences();
    setSelectedServices(preferences.selectedServices);
    setVisibleServiceOptions(preferences.visibleServiceOptions);
    selectedServicesRef.current = preferences.selectedServices;

    if (speakingService && !preferences.selectedServices.includes(speakingService)) {
      window.speechSynthesis.cancel();
      setSpeakingService(null);
    }

    syncResultsFromCache(preferences.selectedServices);
    syncPendingServices(preferences.selectedServices);

    return preferences;
  };

  const syncResultsFromCache = (services: TranslationServiceId[] = selectedServicesRef.current) => {
    const currentSession = sessionRef.current;
    if (!currentSession) {
      setResults([]);
      return;
    }

    setResults(orderResultsByServices(currentSession.cachedResultsByService, services));
  };

  const syncPendingServices = (services: TranslationServiceId[] = selectedServicesRef.current) => {
    setPendingServices(services.filter((service) => pendingServicesRef.current.has(service)));
  };

  const abortAllRequests = () => {
    requestControllersRef.current.forEach((controller) => controller.abort());
    requestControllersRef.current.clear();
    requestPromisesRef.current.clear();
    pendingServicesRef.current.clear();
    syncPendingServices();
  };

  const resetSession = (text: string, translationDirection: TranslationDirection) => {
    abortAllRequests();
    sessionRef.current = {
      sessionKey: buildTranslationSessionKey(text, translationDirection),
      text,
      direction: translationDirection,
      cachedResultsByService: {},
    };
    syncResultsFromCache([]);
  };

  const mergeResultsIntoSession = (translationResults: TranslationResultItem[]) => {
    const currentSession = sessionRef.current;
    if (!currentSession) {
      return;
    }

    currentSession.cachedResultsByService = {
      ...currentSession.cachedResultsByService,
      ...mapResultsByService(decodeResults(translationResults)),
    };
  };

  /**
   * Requests a single provider and keeps the local session cache in sync so
   * provider toggles can reuse finished results instead of re-fetching them.
   */
  const requestServiceResult = (
    text: string,
    translationDirection: TranslationDirection,
    service: TranslationServiceId,
  ): Promise<TranslationResultItem> => {
    const existingPromise = requestPromisesRef.current.get(service);
    if (existingPromise) {
      return existingPromise;
    }

    const controller = new AbortController();
    requestControllersRef.current.set(service, controller);
    pendingServicesRef.current.add(service);
    syncPendingServices();

    const sessionKey = buildTranslationSessionKey(text, translationDirection);
    const requestPromise = translateWithService(
      text,
      service,
      translationDirection,
      controller.signal,
    )
      .then((result) => {
        if (sessionRef.current?.sessionKey === sessionKey) {
          mergeResultsIntoSession([result]);
          syncResultsFromCache();
        }

        return result;
      })
      .finally(() => {
        const currentController = requestControllersRef.current.get(service);
        if (currentController?.signal === controller.signal) {
          requestControllersRef.current.delete(service);
        }

        if (requestPromisesRef.current.get(service) === requestPromise) {
          requestPromisesRef.current.delete(service);
        }

        pendingServicesRef.current.delete(service);
        syncPendingServices();
      });

    requestPromisesRef.current.set(service, requestPromise);
    return requestPromise;
  };

  const runTranslation = async (
    services: TranslationServiceId[],
    translationDirection: TranslationDirection,
    forceRefresh: boolean,
  ) => {
    const trimmedText = inputText.trim();
    if (!trimmedText) {
      return;
    }

    if (services.length === 0) {
      setResults([]);
      setPendingServices([]);
      setError("至少选择一个翻译服务");
      return;
    }

    const sessionKey = buildTranslationSessionKey(trimmedText, translationDirection);
    const currentSession = sessionRef.current;
    const isSameSession = currentSession?.sessionKey === sessionKey;

    if (!isSameSession || forceRefresh) {
      resetSession(trimmedText, translationDirection);
    } else {
    }

    const session = sessionRef.current;
    if (!session) {
      return;
    }

    setError("");
    setIsServiceMenuOpen(false);
    syncResultsFromCache(services);
    syncPendingServices(services);

    const servicesToRequest =
      forceRefresh || !isSameSession
        ? services
        : services.filter(
            (service) =>
              !session.cachedResultsByService[service] && !requestPromisesRef.current.has(service),
          );

    if (servicesToRequest.length === 0) {
      syncResultsFromCache(services);
      return;
    }

    try {
      await Promise.all(
        servicesToRequest.map((service) =>
          requestServiceResult(trimmedText, translationDirection, service),
        ),
      );
    } catch (translateError: unknown) {
      if (isAbortError(translateError)) {
        return;
      }

      const message = translateError instanceof Error ? translateError.message : "翻译出错";
      setError(message);
    }
  };

  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "/" &&
        document.activeElement?.tagName !== "TEXTAREA" &&
        document.activeElement?.tagName !== "INPUT"
      ) {
        event.preventDefault();
        textareaRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
      abortAllRequests();
      window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    window.speechSynthesis.cancel();
    setSpeakingService(null);
  }, [results]);

  useEffect(() => {
    selectedServicesRef.current = selectedServices;
    syncPendingServices(selectedServices);
  }, [selectedServices]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!serviceMenuRef.current?.contains(event.target as Node)) {
        setIsServiceMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    const loadInitialState = async () => {
      const storage = await browser.storage.local.get(["theme"]);
      await refreshServicePreferences();

      const nextTheme = storage.theme === "dracula" ? "dracula" : "light";
      setTheme(nextTheme);
      document.documentElement.setAttribute("data-theme", nextTheme);
    };

    void loadInitialState();
  }, []);

  const handleSettingsSaved = async () => {
    const preferences = await refreshServicePreferences();

    if (inputText.trim()) {
      void runTranslation(preferences.selectedServices, targetLang, false);
    }
  };

  const handleTranslate = async (
    servicesOverride?: TranslationServiceId[],
    targetLangOverride?: TranslationDirection,
  ) => {
    await runTranslation(
      servicesOverride ?? selectedServicesRef.current,
      targetLangOverride ?? targetLang,
      true,
    );
  };

  /**
   * Drops one cached provider result before retrying so its card can switch
   * back to the loading state without disturbing other finished providers.
   */
  const handleRetryService = async (service: TranslationServiceId) => {
    const currentSession = sessionRef.current;
    if (!currentSession || requestPromisesRef.current.has(service)) {
      return;
    }

    const { [service]: _removedResult, ...remainingResults } =
      currentSession.cachedResultsByService;
    currentSession.cachedResultsByService = remainingResults;
    syncResultsFromCache();
    setError("");

    try {
      await requestServiceResult(currentSession.text, currentSession.direction, service);
    } catch (translateError: unknown) {
      if (isAbortError(translateError)) {
        return;
      }

      const message = translateError instanceof Error ? translateError.message : "翻译出错";
      setError(message);
    }
  };

  const handleServiceToggle = async (service: TranslationServiceId) => {
    const nextServices = selectedServicesRef.current.includes(service)
      ? selectedServicesRef.current.filter((item) => item !== service)
      : [...selectedServicesRef.current, service];

    setSelectedServices(nextServices);
    selectedServicesRef.current = nextServices;
    await persistSelectedServices(nextServices);

    if (!nextServices.includes(service) && speakingService === service) {
      window.speechSynthesis.cancel();
      setSpeakingService(null);
    }

    syncResultsFromCache(nextServices);
    syncPendingServices(nextServices);

    if (nextServices.length === 0) {
      setError("至少选择一个翻译服务");
      return;
    }

    setError("");
    if (inputText.trim()) {
      void runTranslation(nextServices, targetLang, false);
    }
  };

  const handleLanguageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newLang: TranslationDirection = event.target.checked ? "zh" : "en";
    setTargetLang(newLang);

    if (inputText.trim() && selectedServicesRef.current.length > 0) {
      void runTranslation(selectedServicesRef.current, newLang, true);
    }
  };

  const toggleTheme = async () => {
    const nextTheme: PopupTheme = theme === "light" ? "dracula" : "light";
    setTheme(nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
    await browser.storage.local.set({ theme: nextTheme });
  };

  const handleCopy = async (service: TranslationServiceId, text: string) => {
    if (!text) {
      return;
    }

    await navigator.clipboard.writeText(text);
    setCopiedService(service);
    window.setTimeout(
      () => setCopiedService((current) => (current === service ? null : current)),
      2000,
    );
  };

  const handleSpeak = (result: TranslationResultItem) => {
    if (result.status !== "success" || !result.translation) {
      return;
    }

    if (speakingService === result.service) {
      window.speechSynthesis.cancel();
      setSpeakingService(null);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(result.translation);
    utterance.lang = result.direction === "zh" ? "zh-CN" : "en-US";
    utterance.onstart = () => setSpeakingService(result.service);
    utterance.onend = () => setSpeakingService(null);
    utterance.onerror = () => setSpeakingService(null);

    window.speechSynthesis.speak(utterance);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      void handleTranslate();
    }
  };

  const resultMap = new Map(results.map((result) => [result.service, result]));
  const pendingServiceSet = new Set(pendingServices);
  const visibleServices = selectedServices.filter(
    (service) => resultMap.has(service) || pendingServiceSet.has(service),
  );

  return (
    <div className="h-full overflow-hidden bg-base-100 text-base-content flex flex-col font-sans relative">
      {isSettingsOpen && (
        <Settings
          onClose={() => setIsSettingsOpen(false)}
          onSaved={() => void handleSettingsSaved()}
        />
      )}

      <div className="flex items-center justify-between px-4 pb-3 pt-4 shrink-0">
        <div className="flex items-center gap-2">
          <img
            src="/icon/32.png"
            alt="中英直译助手 logo"
            className="h-6 w-6 rounded-md shadow-sm"
          />
          <span className="text-base font-semibold opacity-80">中英直译助手</span>
        </div>
        <div className="flex gap-1">
          <button
            className="btn btn-ghost btn-circle btn-xs"
            onClick={toggleTheme}
            title="切换主题"
          >
            {theme === "light" ? <SunIcon className="h-3 w-3" /> : <MoonIcon className="h-3 w-3" />}
          </button>
          <button
            className="btn btn-ghost btn-circle btn-xs"
            onClick={() => setIsSettingsOpen(true)}
            title="设置"
          >
            <SettingsIcon className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="p-4 pt-1 space-y-4 flex-1 overflow-y-auto">
        <div className="form-control">
          <textarea
            autoFocus
            ref={textareaRef}
            className="textarea textarea-bordered w-full h-28 resize-none transition-colors"
            placeholder={`输入要翻译的文字到${targetLang === "zh" ? "中文" : "英文"}... (Shift+Enter 快速翻译)`}
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button
              className="btn btn-outline btn-primary btn-xs h-8 min-h-8 min-w-0 flex-1 px-4"
              onClick={() => void handleTranslate()}
              disabled={!inputText.trim() || selectedServices.length === 0}
            >
              {isLoading ? <span className="loading loading-spinner loading-sm"></span> : "翻译"}
            </button>
            <div ref={serviceMenuRef} className="dropdown dropdown-bottom relative w-36 shrink-0">
              <button
                type="button"
                className="btn btn-outline btn-xs h-8 min-h-8 w-full justify-between px-2.5"
                onClick={() => setIsServiceMenuOpen((current) => !current)}
              >
                <span className="truncate text-xs font-normal">
                  {getSelectedServicesSummary(selectedServices)}
                </span>
                <span
                  className={`text-xs transition-transform ${isServiceMenuOpen ? "rotate-180" : ""}`}
                >
                  ▼
                </span>
              </button>
              {isServiceMenuOpen && (
                <div className="absolute left-0 top-full z-30 mt-2 w-38 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg space-y-1">
                  {visibleServiceOptions.map((serviceOption) => {
                    const isSelected = selectedServices.includes(serviceOption.id);
                    return (
                      <button
                        key={serviceOption.id}
                        type="button"
                        className="flex w-full items-center gap-3 rounded-lg px-2 py-1 text-left hover:bg-base-200"
                        aria-pressed={isSelected}
                        onClick={() => void handleServiceToggle(serviceOption.id)}
                      >
                        <span
                          className={`w-4 text-center text-sm font-semibold ${
                            isSelected ? "text-primary" : "opacity-0"
                          }`}
                          aria-hidden="true"
                        >
                          ✓
                        </span>
                        <span className="label-text flex-1">{serviceOption.label}</span>
                      </button>
                    );
                  })}
                  {selectedServices.length === 0 && (
                    <p className="px-2 pt-1 text-xs text-error">至少选择一个翻译服务</p>
                  )}
                </div>
              )}
            </div>
            <label
              className="btn btn-outline btn-xs h-8 min-h-8 w-12 px-0 swap swap-flip shrink-0"
              title="切换目标语言"
            >
              <input
                type="checkbox"
                checked={targetLang === "zh"}
                onChange={handleLanguageChange}
              />
              <span className="swap-on text-xs font-semibold">中</span>
              <span className="swap-off text-xs font-semibold">EN</span>
            </label>
          </div>
          {selectedServices.length === 0 && (
            <p className="text-xs text-error">至少选择一个翻译服务</p>
          )}
        </div>

        {error && (
          <div className="alert alert-error shadow-sm py-2">
            <ErrorIcon className="stroke-current shrink-0 h-5 w-5" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {visibleServices.length > 0 && (
          <div className="space-y-3">
            {visibleServices.map((service) => {
              const result = resultMap.get(service);

              if (!result) {
                return (
                  <div
                    key={service}
                    className="card bg-base-200 shadow-inner border border-base-300 overflow-hidden rounded-xl"
                  >
                    <div className="card-body p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <div className="badge badge-xs badge-outline">
                            {getServiceLabel(service)}
                          </div>
                        </div>
                      </div>
                      <div
                        className="flex items-center text-sm opacity-70"
                        aria-label="正在获取翻译结果"
                      >
                        <span className="loading loading-spinner loading-xs"></span>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={result.service}
                  className="card bg-base-200 shadow-inner border border-base-300 overflow-hidden rounded-xl"
                >
                  <div className="card-body p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <div className="badge badge-xs badge-outline">{result.serviceLabel}</div>
                      </div>
                      <div className="flex gap-1">
                        {result.status === "error" ? (
                          <button
                            className="btn btn-ghost btn-xs btn-circle min-h-0 h-6 w-6 p-0"
                            onClick={() => void handleRetryService(result.service)}
                            title="重试"
                          >
                            <RetryIcon className="h-3 w-3 shrink-0" />
                          </button>
                        ) : (
                          <>
                            <button
                              className={`btn btn-ghost btn-xs btn-circle min-h-0 h-6 w-6 p-0 ${
                                speakingService === result.service ? "text-primary" : ""
                              }`}
                              onClick={() => handleSpeak(result)}
                              title={speakingService === result.service ? "停止朗读" : "朗读"}
                              disabled={result.status !== "success"}
                            >
                              {speakingService === result.service ? (
                                <StopIcon className="h-3 w-3" />
                              ) : (
                                <SpeakerIcon className="h-3 w-3" />
                              )}
                            </button>
                            <button
                              className="btn btn-ghost btn-xs btn-circle min-h-0 h-6 w-6 p-0"
                              onClick={() => void handleCopy(result.service, result.translation)}
                              title="复制"
                              disabled={result.status !== "success"}
                            >
                              {copiedService === result.service ? (
                                <CheckIcon className="h-3 w-3 text-green-500 shrink-0" />
                              ) : (
                                <CopyIcon className="h-3 w-3 shrink-0" />
                              )}
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {result.status === "success" ? (
                      <p className="text-sm whitespace-pre-wrap">{result.translation}</p>
                    ) : (
                      <div className="alert alert-error alert-soft py-1">
                        <ErrorIcon className="stroke-current shrink-0 h-4 w-4" />
                        <span className="text-sm">😟 {result.error}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <footer className="px-4 py-2 bg-base-200 text-base-content border-t border-base-300 shrink-0 flex justify-between items-center">
        <p className="text-[10px] opacity-60">
          V{__APP_VERSION__} © 2026
          <a href="https://translate-extension.tingyuan.in" target="_blank" className="ml-1 link">
            Translate Extension
          </a>
        </p>
        <a
          href="https://github.com/lovetingyuan/translate-extension"
          target="_blank"
          rel="noopener noreferrer"
          title="Github"
          className="hover:text-primary transition-colors opacity-50 hover:opacity-100 flex items-center"
        >
          <GithubIcon className="h-3.5 w-3.5" />
        </a>
      </footer>
    </div>
  );
}

export default App;
