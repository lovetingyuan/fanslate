import { useEffect, useRef, useState } from "react";
import Settings from "./Settings";
import { ErrorIcon } from "../components/icons";
import {
  detectDirection,
  type TranslationDirection,
  type TranslationServiceId,
} from "../../utils/translation";
import { useTranslationSession } from "./hooks/useTranslationSession";
import { useServicePreferences } from "./hooks/useServicePreferences";
import { useTheme } from "./hooks/useTheme";
import { useSpeech } from "./hooks/useSpeech";
import { useCopy } from "./hooks/useCopy";
import { useTranslationHistory } from "./hooks/useTranslationHistory";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { TranslationInput } from "./components/TranslationInput";
import { TranslationControls } from "./components/TranslationControls";
import { ResultList } from "./components/ResultList";
import { TranslationHistory } from "./components/TranslationHistory";

function App() {
  const [inputText, setInputText] = useState("");
  const [targetLang, setTargetLang] = useState<TranslationDirection>("en");
  const [error, setError] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isServiceMenuOpen, setIsServiceMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** 是否保留尚未翻译的文本，与 storage 中的 keepUntranslatedInput 同步 */
  const keepUntranslatedInputRef = useRef(false);

  const {
    runTranslation: sessionRunTranslation,
    retryService,
    abortAllRequests,
    getCurrentResults,
    getCurrentPendingServices,
    isAbortError: checkIsAbortError,
  } = useTranslationSession();
  const {
    selectedServices,
    visibleServiceOptions,
    selectedServicesRef,
    refreshServicePreferences,
    toggleService,
  } = useServicePreferences();
  const { theme, toggleTheme } = useTheme();
  const { speakingService, handleSpeak, stopSpeaking } = useSpeech();
  const { copiedService, handleCopy } = useCopy();
  const { historyItems, recordHistory } = useTranslationHistory();

  const currentResults = getCurrentResults(selectedServices);
  const currentPendingServices = getCurrentPendingServices(selectedServices);
  const isLoading = currentPendingServices.length > 0;

  const runTranslation = async (
    sourceText: string,
    services: TranslationServiceId[],
    translationDirection: TranslationDirection,
    forceRefresh: boolean,
  ) => {
    const trimmedText = sourceText.trim();
    if (!trimmedText) {
      return;
    }

    if (services.length === 0) {
      setError("至少选择一个翻译服务");
      return;
    }

    setError("");
    setIsServiceMenuOpen(false);

    // 翻译触发时清除草稿，避免下次打开时恢复已翻译的文本
    void browser.storage.local.remove("draftInputText");

    // 用户发起翻译时立即记录历史，无需等待翻译结果返回
    void recordHistory(trimmedText);

    try {
      await sessionRunTranslation(
        trimmedText,
        services,
        translationDirection,
        forceRefresh,
      );
    } catch (translateError: unknown) {
      if (checkIsAbortError(translateError)) {
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
    };
  }, [abortAllRequests]);

  useEffect(() => {
    const loadInitialState = async () => {
      await refreshServicePreferences();

      const res = await browser.storage.local.get(["keepUntranslatedInput", "draftInputText"]);
      const keepDraft = (res.keepUntranslatedInput as boolean | undefined) ?? false;
      keepUntranslatedInputRef.current = keepDraft;

      if (keepDraft && res.draftInputText) {
        const draft = res.draftInputText as string;
        setInputText(draft);
        setTargetLang(detectDirection(draft));
      }
    };

    void loadInitialState();
  }, [refreshServicePreferences]);

  const handleSettingsSaved = async () => {
    const preferences = await refreshServicePreferences();

    // 重新加载 keepUntranslatedInput 设置
    const res = await browser.storage.local.get("keepUntranslatedInput");
    keepUntranslatedInputRef.current = (res.keepUntranslatedInput as boolean | undefined) ?? false;

    if (speakingService && !preferences.selectedServices.includes(speakingService)) {
      stopSpeaking();
    }

    if (inputText.trim()) {
      void runTranslation(inputText, preferences.selectedServices, targetLang, false);
    }

    textareaRef.current?.focus();
  };

  const handleTranslate = async (
    servicesOverride?: TranslationServiceId[],
    targetLangOverride?: TranslationDirection,
  ) => {
    await runTranslation(
      inputText,
      servicesOverride ?? selectedServicesRef.current,
      targetLangOverride ?? targetLang,
      true,
    );
  };

  const handleRetryService = async (service: TranslationServiceId) => {
    setError("");

    try {
      await retryService(service);
    } catch (translateError: unknown) {
      if (checkIsAbortError(translateError)) {
        return;
      }

      const message = translateError instanceof Error ? translateError.message : "翻译出错";
      setError(message);
    }
  };

  const handleServiceToggle = async (service: TranslationServiceId) => {
    const nextServices = await toggleService(service);

    if (!nextServices.includes(service) && speakingService === service) {
      stopSpeaking();
    }

    if (nextServices.length === 0) {
      setError("至少选择一个翻译服务");
      return;
    }

    setError("");
    if (inputText.trim()) {
      void runTranslation(inputText, nextServices, targetLang, false);
    }
  };

  const handleLanguageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newLang: TranslationDirection = event.target.checked ? "zh" : "en";
    setTargetLang(newLang);

    if (inputText.trim() && selectedServicesRef.current.length > 0) {
      void runTranslation(inputText, selectedServicesRef.current, newLang, true);
    }
  };

  const handleInputChange = (value: string) => {
    setInputText(value);

    if (value.trim()) {
      setTargetLang(detectDirection(value));
    }

    // 若开启了"保留尚未翻译的文本"，则实时保存草稿
    if (keepUntranslatedInputRef.current) {
      void browser.storage.local.set({ draftInputText: value });
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      void handleTranslate();
    }
  };

  const handleHistorySelect = (text: string) => {
    setInputText(text);

    const detectedDirection = detectDirection(text);
    setTargetLang(detectedDirection);

    if (selectedServicesRef.current.length > 0) {
      void runTranslation(text, selectedServicesRef.current, detectedDirection, true);
    }
  };

  useEffect(() => {
    stopSpeaking();
  }, [currentResults, stopSpeaking]);

  return (
    <div className="h-full overflow-hidden bg-base-100 text-base-content flex flex-col font-sans relative">
      {isSettingsOpen && (
        <Settings
          onClose={() => { setIsSettingsOpen(false); textareaRef.current?.focus(); }}
          onSaved={() => void handleSettingsSaved()}
        />
      )}

      <Header
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      <div className="p-4 pt-1 space-y-4 flex-1 overflow-y-auto">
        <TranslationInput
          value={inputText}
          targetLang={targetLang}
          textareaRef={textareaRef}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
        />

        <TranslationHistory items={historyItems} onSelect={handleHistorySelect} />

        <TranslationControls
          isLoading={isLoading}
          inputText={inputText}
          targetLang={targetLang}
          selectedServices={selectedServices}
          visibleServiceOptions={visibleServiceOptions}
          isServiceMenuOpen={isServiceMenuOpen}
          onTranslate={() => void handleTranslate()}
          onLanguageChange={handleLanguageChange}
          onServiceMenuToggle={() => setIsServiceMenuOpen((current) => !current)}
          onServiceToggle={(service) => void handleServiceToggle(service)}
          onServiceMenuClose={() => setIsServiceMenuOpen(false)}
        />

        {error && (
          <div className="alert alert-error shadow-sm py-2">
            <ErrorIcon className="stroke-current shrink-0 h-5 w-5" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        <ResultList
          results={currentResults}
          pendingServices={currentPendingServices}
          selectedServices={selectedServices}
          copiedService={copiedService}
          speakingService={speakingService}
          onRetry={(service) => void handleRetryService(service)}
          onCopy={handleCopy}
          onSpeak={handleSpeak}
        />
      </div>

      <Footer />
    </div>
  );
}

export default App;
