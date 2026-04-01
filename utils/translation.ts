import { getApiKey } from "./keyResolver";
import { logger } from "./logger";

export const TRANSLATION_SERVICE_IDS = ["google", "microsoft", "tencent", "openrouter"] as const;

export type TranslationServiceId = (typeof TRANSLATION_SERVICE_IDS)[number];
export type TranslationDirection = "zh" | "en";
export type TranslationResultStatus = "success" | "error";

export interface TranslationServiceOption {
  id: TranslationServiceId;
  label: string;
}

export interface TranslationResultItem {
  service: TranslationServiceId;
  serviceLabel: string;
  status: TranslationResultStatus;
  translation: string;
  error: string;
  direction: TranslationDirection;
}

export interface TranslationBatchResult {
  results: TranslationResultItem[];
  direction: TranslationDirection;
}

/**
 * Stores translation results by service so UI layers can incrementally merge,
 * filter, and re-order cards without re-requesting finished providers.
 */
export type TranslationResultsByService = Partial<
  Record<TranslationServiceId, TranslationResultItem>
>;

export interface TranslateWithServicesOptions {
  signal?: AbortSignal;
}

interface OpenRouterMessage {
  content?: string;
}

interface OpenRouterChoice {
  message?: OpenRouterMessage;
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
}

interface MicrosoftTranslation {
  text?: string;
}

interface MicrosoftTranslationResponseItem {
  translations?: MicrosoftTranslation[];
}

/**
 * Bundles the persisted provider visibility and selection state so popup and
 * content-script UIs can stay consistent after migrations or settings changes.
 */
export interface TranslationServicePreferences {
  selectedServices: TranslationServiceId[];
  hiddenServices: TranslationServiceId[];
  visibleServiceOptions: TranslationServiceOption[];
}

type TranslatorFunction = (
  text: string,
  targetLang: TranslationDirection,
  signal?: AbortSignal,
) => Promise<string>;

const DEFAULT_SELECTED_SERVICES: TranslationServiceId[] = ["google"];
const DEFAULT_HIDDEN_SERVICES: TranslationServiceId[] = ["tencent"];
const EXPIRATION_BUFFER_MS = 1000;
const SELECTED_SERVICES_STORAGE_KEY = "selectedServices";
const LEGACY_SELECTED_SERVICE_STORAGE_KEY = "selectedService";
const HIDDEN_SERVICES_STORAGE_KEY = "hiddenServices";

export const TRANSLATION_SERVICE_OPTIONS: TranslationServiceOption[] = [
  { id: "google", label: "Google 翻译" },
  { id: "microsoft", label: "Microsoft 翻译" },
  { id: "tencent", label: "腾讯翻译" },
  { id: "openrouter", label: "OpenRouter" },
];

const TRANSLATION_SERVICE_LABELS: Record<TranslationServiceId, string> = {
  google: "Google 翻译",
  microsoft: "Microsoft 翻译",
  tencent: "腾讯翻译",
  openrouter: "OpenRouter",
};

let msTokenCache: { token: string; expiresAt: number } | null = null;

export const isTranslationServiceId = (value: unknown): value is TranslationServiceId =>
  typeof value === "string" && TRANSLATION_SERVICE_IDS.includes(value as TranslationServiceId);

const normalizeServiceIds = (value: unknown): TranslationServiceId[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.reduce<TranslationServiceId[]>((services, item) => {
    if (isTranslationServiceId(item) && !services.includes(item)) {
      services.push(item);
    }
    return services;
  }, []);
};

const areSameServiceLists = (
  left: TranslationServiceId[],
  right: TranslationServiceId[],
): boolean =>
  left.length === right.length && left.every((service, index) => service === right[index]);

const getVisibleServiceIds = (hiddenServices: TranslationServiceId[]): TranslationServiceId[] => {
  return TRANSLATION_SERVICE_IDS.filter((service) => !hiddenServices.includes(service));
};

const filterHiddenServices = (
  services: TranslationServiceId[],
  hiddenServices: TranslationServiceId[],
): TranslationServiceId[] => {
  return services.filter((service) => !hiddenServices.includes(service));
};

const resolveFallbackSelectedServices = (
  hiddenServices: TranslationServiceId[],
): TranslationServiceId[] => {
  const visibleDefaultServices = filterHiddenServices(DEFAULT_SELECTED_SERVICES, hiddenServices);
  if (visibleDefaultServices.length > 0) {
    return visibleDefaultServices;
  }

  const firstVisibleService = getVisibleServiceIds(hiddenServices)[0];
  return firstVisibleService ? [firstVisibleService] : [];
};

const normalizeSelectedServices = (
  value: unknown,
  hiddenServices: TranslationServiceId[],
): TranslationServiceId[] => {
  const visibleSelectedServices = filterHiddenServices(normalizeServiceIds(value), hiddenServices);
  return visibleSelectedServices.length > 0
    ? visibleSelectedServices
    : resolveFallbackSelectedServices(hiddenServices);
};

const normalizeHiddenServices = (value: unknown): TranslationServiceId[] => {
  return normalizeServiceIds(value);
};

export const getVisibleTranslationServiceOptions = (
  hiddenServices: TranslationServiceId[],
): TranslationServiceOption[] => {
  return TRANSLATION_SERVICE_OPTIONS.filter((option) => !hiddenServices.includes(option.id));
};

const loadServicePreferencesFromStorage = async (): Promise<TranslationServicePreferences> => {
  const result = await browser.storage.local.get([
    SELECTED_SERVICES_STORAGE_KEY,
    LEGACY_SELECTED_SERVICE_STORAGE_KEY,
    HIDDEN_SERVICES_STORAGE_KEY,
  ]);

  const hasStoredHiddenServices = HIDDEN_SERVICES_STORAGE_KEY in result;
  const hiddenServices = hasStoredHiddenServices
    ? normalizeHiddenServices(result.hiddenServices)
    : DEFAULT_HIDDEN_SERVICES;

  const storedSelectedServices =
    SELECTED_SERVICES_STORAGE_KEY in result
      ? result.selectedServices
      : [result[LEGACY_SELECTED_SERVICE_STORAGE_KEY]];

  const selectedServices = normalizeSelectedServices(storedSelectedServices, hiddenServices);
  const visibleServiceOptions = getVisibleTranslationServiceOptions(hiddenServices);

  const storageUpdates: Record<string, TranslationServiceId[]> = {};
  if (
    !hasStoredHiddenServices ||
    !areSameServiceLists(hiddenServices, normalizeHiddenServices(result.hiddenServices))
  ) {
    storageUpdates[HIDDEN_SERVICES_STORAGE_KEY] = hiddenServices;
  }

  if (
    !(SELECTED_SERVICES_STORAGE_KEY in result) ||
    !areSameServiceLists(selectedServices, normalizeServiceIds(result.selectedServices))
  ) {
    storageUpdates[SELECTED_SERVICES_STORAGE_KEY] = selectedServices;
  }

  if (Object.keys(storageUpdates).length > 0) {
    await browser.storage.local.set(storageUpdates);
  }

  if (LEGACY_SELECTED_SERVICE_STORAGE_KEY in result) {
    await browser.storage.local.remove(LEGACY_SELECTED_SERVICE_STORAGE_KEY);
  }

  return {
    selectedServices,
    hiddenServices,
    visibleServiceOptions,
  };
};

const createAbortError = (): DOMException => {
  return new DOMException("Translation aborted", "AbortError");
};

export const buildTranslationSessionKey = (text: string, direction: TranslationDirection): string =>
  `${direction}::${text}`;

/**
 * Centralizes abort detection because browser messaging and fetch can surface
 * slightly different error shapes when a translation batch is cancelled.
 */
export const isAbortError = (error: unknown): boolean => {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      error.name === "AbortError" ||
      message.includes("aborterror") ||
      message.includes("aborted") ||
      message.includes("signal is aborted")
    );
  }

  return false;
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
};

const parseMSToken = (token: string): number => {
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(atob(payload)) as { exp?: number };
    return decoded.exp ?? 0;
  } catch (err) {
    logger.error("parseMSToken error:", err);
    return 0;
  }
};

const getMicrosoftToken = async (): Promise<string> => {
  const now = Date.now();

  if (msTokenCache && msTokenCache.expiresAt > now + EXPIRATION_BUFFER_MS) {
    logger.log("使用缓存的Microsoft token");
    return msTokenCache.token;
  }

  const storageResult = await browser.storage.local.get("msAuthToken");
  const storageToken = storageResult.msAuthToken as string | undefined;

  if (storageToken) {
    const storageExp = parseMSToken(storageToken);
    const storageExpiresAt = storageExp * 1000;

    if (storageExpiresAt > now + EXPIRATION_BUFFER_MS) {
      logger.log("使用storage缓存的Microsoft token");
      msTokenCache = { token: storageToken, expiresAt: storageExpiresAt };
      return storageToken;
    }
  }

  logger.log("获取新的Microsoft token");
  const response = await fetch("https://edge.microsoft.com/translate/auth");

  if (!response.ok) {
    throw new Error(`Microsoft token请求失败: ${response.status}`);
  }

  const token = await response.text();
  const exp = parseMSToken(token);
  const expiresAt = exp * 1000;

  await browser.storage.local.set({ msAuthToken: token });
  msTokenCache = { token, expiresAt };

  logger.log("Microsoft token获取成功，过期时间:", new Date(expiresAt));
  return token;
};

const translateWithGoogle = async (
  text: string,
  targetLang: TranslationDirection,
  signal?: AbortSignal,
): Promise<string> => {
  const url = "https://translate-pa.googleapis.com/v1/translateHtml";

  logger.log("正在请求Google翻译API:", url);

  const apiKey = import.meta.env?.WXT_GOOGLE_HTML_API_KEY || getApiKey();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json+protobuf",
      "X-Goog-API-Key": apiKey,
      "user-agent": navigator.userAgent,
      accept: "*/*",
      "accept-encoding": "gzip, deflate, br",
      "accept-language": "en,zh-CN;q=0.9,zh;q=0.8,ja;q=0.7,en-US;q=0.6",
    },
    body: JSON.stringify([[[text], "auto", targetLang], "wt_lib"]),
    signal,
  });

  logger.log("GoogleHtml翻译API响应状态:", response.status, response.statusText);

  if (!response.ok) {
    throw new Error(`GoogleHtml翻译请求失败: ${response.status}`);
  }

  const data = (await response.json()) as unknown;
  logger.log("GoogleHtml翻译API返回数据:", JSON.stringify(data, null, 2));

  if (Array.isArray(data) && data.length > 0) {
    const firstItem = data[0];

    if (typeof firstItem === "number") {
      const message = typeof data[1] === "string" ? data[1] : "未知错误";
      throw new Error(`GoogleHtml翻译API错误 (${firstItem}): ${message}`);
    }

    if (Array.isArray(firstItem) && firstItem.length > 0 && typeof firstItem[0] === "string") {
      return firstItem[0];
    }

    if (typeof firstItem === "string") {
      return firstItem;
    }
  }

  throw new Error("GoogleHtml翻译返回数据格式错误");
};

const translateWithMicrosoft = async (
  text: string,
  targetLang: TranslationDirection,
  signal?: AbortSignal,
): Promise<string> => {
  const toLang = targetLang === "zh" ? "zh-Hans" : "en";
  const url = `https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&from=&to=${toLang}`;

  logger.log("正在请求Microsoft翻译API:", url);

  const token = await getMicrosoftToken();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "*/*",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
      authorization: `Bearer ${token}`,
      "cache-control": "no-cache",
      "content-type": "application/json",
      pragma: "no-cache",
    },
    body: JSON.stringify([{ Text: text }]),
    signal,
  });

  logger.log("Microsoft翻译API响应状态:", response.status, response.statusText);

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("Microsoft翻译API错误响应:", errorText);
    throw new Error(`Microsoft翻译请求失败: ${response.status}`);
  }

  const data = (await response.json()) as MicrosoftTranslationResponseItem[];
  logger.log("Microsoft翻译API返回数据:", data);

  const translation = data[0]?.translations?.[0]?.text;
  if (typeof translation === "string") {
    return translation;
  }

  throw new Error("Microsoft翻译返回数据格式错误");
};

const translateWithTencent = async (
  text: string,
  targetLang: TranslationDirection,
  signal?: AbortSignal,
): Promise<string> => {
  const url = "https://transmart.qq.com/api/imt";

  logger.log("正在请求Tencent翻译API:", url);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": navigator.userAgent,
      Referer: "https://transmart.qq.com/zh-CN/index",
    },
    body: JSON.stringify({
      header: {
        fn: "auto_translation",
        client_key:
          "browser-chrome-110.0.0-Mac OS-df4bd4c5-a65d-44b2-a40f-42f34f3535f2-1677486696487",
      },
      type: "plain",
      model_category: "normal",
      source: {
        text_list: [text],
        lang: "auto",
      },
      target: {
        lang: targetLang,
      },
    }),
    signal,
  });

  logger.log("Tencent翻译API响应状态:", response.status, response.statusText);

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("Tencent翻译API错误响应:", errorText);
    throw new Error(`Tencent翻译请求失败: ${response.status}`);
  }

  const data = (await response.json()) as { auto_translation?: unknown };
  logger.log("Tencent翻译API返回数据:", data);

  if (Array.isArray(data.auto_translation) && typeof data.auto_translation[0] === "string") {
    return data.auto_translation[0];
  }

  throw new Error("Tencent翻译返回数据格式错误");
};

const translateWithOpenRouter = async (
  text: string,
  targetLang: TranslationDirection,
  signal?: AbortSignal,
): Promise<string> => {
  const settings = await browser.storage.local.get(["openRouterApiKey", "openRouterModelId"]);
  const userApiKey = settings.openRouterApiKey as string | undefined;
  const userModelId = settings.openRouterModelId as string | undefined;

  const envApiKey = import.meta.env?.WXT_OPENROUTER_API_KEY;
  const envModelId = import.meta.env?.WXT_OPENROUTER_MODEL;

  const apiKey = userApiKey || envApiKey;
  const model = userModelId || envModelId || "openrouter/free";

  if (!apiKey) {
    throw new Error("OpenRouter API Key 未配置 (请在设置中配置或检查环境变量)");
  }

  const url = "https://openrouter.ai/api/v1/chat/completions";
  const languageName = targetLang === "zh" ? "Chinese" : "English";
  const systemPrompt = `Translate the content within <source_text> tags into ${languageName}.
Rules:
1. Ensure the translation is natural, fluent, and uses common native expressions.
2. Output ONLY the translation. No any extra content.
3. Try to preserve original formatting.`;

  logger.log("正在请求OpenRouter翻译API:", url, "Model:", model);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/wxt-dev/wxt",
      "X-Title": "Translation Extension",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Translate the content inside <source_text> to ${languageName}:\n<source_text>\n${text}\n</source_text>`,
        },
      ],
    }),
    signal,
  });

  logger.log("OpenRouter API响应状态:", response.status, response.statusText);

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("OpenRouter API错误响应:", errorText);
    throw new Error(`OpenRouter请求失败: ${response.status}`);
  }

  const data = (await response.json()) as OpenRouterResponse;
  logger.log("OpenRouter API返回数据:", data);

  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }

  throw new Error("OpenRouter翻译返回数据格式错误");
};

const translatorMap: Record<TranslationServiceId, TranslatorFunction> = {
  google: translateWithGoogle,
  microsoft: translateWithMicrosoft,
  tencent: translateWithTencent,
  openrouter: translateWithOpenRouter,
};

export const getServiceLabel = (service: TranslationServiceId): string => {
  return TRANSLATION_SERVICE_LABELS[service];
};

export const mapResultsByService = (
  results: TranslationResultItem[],
): TranslationResultsByService => {
  return results.reduce<TranslationResultsByService>((accumulator, result) => {
    accumulator[result.service] = result;
    return accumulator;
  }, {});
};

/**
 * Preserves the user's selected provider order so restored cached cards and new
 * results appear in a stable, predictable sequence.
 */
export const orderResultsByServices = (
  resultsByService: TranslationResultsByService,
  services: TranslationServiceId[],
): TranslationResultItem[] => {
  return services.flatMap((service) => {
    const result = resultsByService[service];
    return result ? [result] : [];
  });
};

/**
 * Keeps the service selector label compact while still reflecting the user's
 * saved service order across popup and in-page dialog.
 */
export const getSelectedServicesSummary = (services: TranslationServiceId[]): string => {
  if (services.length === 0) {
    return "未选择服务";
  }

  const firstLabel = getServiceLabel(services[0]);
  if (services.length === 1) {
    return firstLabel;
  }

  return `${firstLabel} +${services.length - 1}`;
};

/**
 * Reads the user's enabled translation services and transparently migrates the
 * legacy single-select storage key on first access.
 */
export const getSelectedServices = async (): Promise<TranslationServiceId[]> => {
  const preferences = await loadServicePreferencesFromStorage();
  return preferences.selectedServices;
};

/**
 * Exposes the normalized provider visibility state so all UIs can render the
 * same visible provider list and heal persisted selections automatically.
 */
export const getTranslationServicePreferences = async (): Promise<TranslationServicePreferences> =>
  loadServicePreferencesFromStorage();

/**
 * Reads the persisted hidden-provider list and applies the default migration
 * that hides Tencent for existing installs the first time this code runs.
 */
export const getHiddenServices = async (): Promise<TranslationServiceId[]> => {
  const preferences = await loadServicePreferencesFromStorage();
  return preferences.hiddenServices;
};

/**
 * Persists the exact service order chosen in the UI so both popup and page
 * dialog can render results in the same predictable order.
 */
export const setSelectedServices = async (
  services: TranslationServiceId[],
): Promise<TranslationServiceId[]> => {
  const hiddenServices = await getHiddenServices();
  const normalizedServices = normalizeSelectedServices(services, hiddenServices);
  await browser.storage.local.set({ [SELECTED_SERVICES_STORAGE_KEY]: normalizedServices });
  await browser.storage.local.remove(LEGACY_SELECTED_SERVICE_STORAGE_KEY);
  return normalizedServices;
};

/**
 * Persists provider visibility rules and immediately revalidates the selected
 * provider order so hidden services cannot remain active in later requests.
 */
export const setHiddenServices = async (
  hiddenServices: TranslationServiceId[],
): Promise<TranslationServicePreferences> => {
  const normalizedHiddenServices = normalizeHiddenServices(hiddenServices);
  const visibleServiceOptions = getVisibleTranslationServiceOptions(normalizedHiddenServices);

  if (visibleServiceOptions.length === 0) {
    throw new Error("至少保留一个可见翻译服务");
  }

  const result = await browser.storage.local.get([
    SELECTED_SERVICES_STORAGE_KEY,
    LEGACY_SELECTED_SERVICE_STORAGE_KEY,
  ]);
  const storedSelectedServices =
    SELECTED_SERVICES_STORAGE_KEY in result
      ? result.selectedServices
      : [result[LEGACY_SELECTED_SERVICE_STORAGE_KEY]];

  const selectedServices = normalizeSelectedServices(
    storedSelectedServices,
    normalizedHiddenServices,
  );

  await browser.storage.local.set({
    [HIDDEN_SERVICES_STORAGE_KEY]: normalizedHiddenServices,
    [SELECTED_SERVICES_STORAGE_KEY]: selectedServices,
  });
  await browser.storage.local.remove(LEGACY_SELECTED_SERVICE_STORAGE_KEY);

  return {
    selectedServices,
    hiddenServices: normalizedHiddenServices,
    visibleServiceOptions,
  };
};

export const detectDirection = (text: string): TranslationDirection => {
  const cnCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const enCount = (text.match(/[a-zA-Z]/g) || []).length;

  return enCount > cnCount * 3 ? "zh" : "en";
};

/**
 * Encapsulates a single provider request so callers can cache or retry each
 * service independently while keeping the existing per-provider error payload.
 */
export const translateWithService = async (
  text: string,
  service: TranslationServiceId,
  targetLang?: TranslationDirection,
  signal?: AbortSignal,
): Promise<TranslationResultItem> => {
  const finalDirection = targetLang || detectDirection(text);
  const translator = translatorMap[service];

  try {
    const translation = await translator(text, finalDirection, signal);

    if (signal?.aborted) {
      throw createAbortError();
    }

    return {
      service,
      serviceLabel: getServiceLabel(service),
      status: "success",
      translation,
      error: "",
      direction: finalDirection,
    };
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      throw error;
    }

    return {
      service,
      serviceLabel: getServiceLabel(service),
      status: "error",
      translation: "",
      error: getErrorMessage(error, `${getServiceLabel(service)} 翻译失败`),
      direction: finalDirection,
    };
  }
};

/**
 * Executes all requested translators in parallel. Callers provide their own
 * AbortSignal so popup and in-page dialog can cancel only the requests that
 * belong to the active translation session.
 */
export const translateWithServices = async (
  text: string,
  services?: TranslationServiceId[],
  targetLang?: TranslationDirection,
  options?: TranslateWithServicesOptions,
): Promise<TranslationBatchResult> => {
  const finalDirection = targetLang || detectDirection(text);
  const signal = options?.signal;
  const hiddenServices = await getHiddenServices();
  const selectedServices = services
    ? filterHiddenServices(normalizeServiceIds(services), hiddenServices)
    : await getSelectedServices();

  if (selectedServices.length === 0) {
    throw new Error("至少选择一个翻译服务");
  }

  const results = await Promise.all(
    selectedServices.map((service) => translateWithService(text, service, finalDirection, signal)),
  );

  if (signal?.aborted) {
    throw createAbortError();
  }

  return { results, direction: finalDirection };
};

export const translateText = async (
  text: string,
  service?: TranslationServiceId,
  targetLang?: TranslationDirection,
): Promise<{ translation: string; direction: TranslationDirection }> => {
  const selectedServices = service ? [service] : await getSelectedServices();
  const firstService = selectedServices[0];

  if (!firstService) {
    throw new Error("至少选择一个翻译服务");
  }

  const batchResult = await translateWithServices(text, [firstService], targetLang);
  const firstResult = batchResult.results[0];

  if (!firstResult) {
    throw new Error("未返回翻译结果");
  }

  if (firstResult.status === "error") {
    throw new Error(firstResult.error || "翻译失败");
  }

  return {
    translation: firstResult.translation,
    direction: batchResult.direction,
  };
};
