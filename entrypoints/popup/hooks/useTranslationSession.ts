import { useCallback, useRef, useState } from "react";
import { decodeResults } from "../../../utils/decode";
import {
  buildTranslationSessionKey,
  isAbortError,
  mapResultsByService,
  orderResultsByServices,
  translateWithService,
  type TranslationDirection,
  type TranslationResultItem,
  type TranslationResultsByService,
  type TranslationServiceId,
} from "../../../utils/translation";

interface PopupTranslationSession {
  sessionKey: string;
  text: string;
  direction: TranslationDirection;
  cachedResultsByService: TranslationResultsByService;
}

/**
 * 管理 Popup 翻译会话的 Hook。
 *
 * 所有影响 UI 渲染的数据（session 缓存、pending 服务列表）使用 React state 存储，
 * 确保 React Compiler 的自动 memo 化能正确追踪数据依赖并触发重渲染。
 *
 * 仅用于内部请求管理的数据（AbortController、Promise 引用）保持 ref 存储，
 * 避免不必要的重渲染。
 */
export const useTranslationSession = () => {
  /** 当前翻译会话（包含缓存的翻译结果），驱动 UI 渲染 */
  const [session, setSession] = useState<PopupTranslationSession | null>(null);

  /** 当前正在等待响应的翻译服务集合，驱动 loading 状态显示 */
  const [pendingServices, setPendingServices] = useState<Set<TranslationServiceId>>(new Set());

  /** 内部：每个服务对应的 AbortController，用于取消请求 */
  const requestControllersRef = useRef<Map<TranslationServiceId, AbortController>>(new Map());

  /** 内部：每个服务对应的请求 Promise，用于去重 */
  const requestPromisesRef = useRef<Map<TranslationServiceId, Promise<TranslationResultItem>>>(
    new Map(),
  );

  /**
   * 内部：session ref 用于在异步回调中安全访问最新 session（避免闭包捕获旧值）。
   * 与 state 保持同步，但不驱动渲染。
   */
  const sessionRef = useRef<PopupTranslationSession | null>(null);

  /** 中止所有进行中的翻译请求，清理控制器和 pending 状态 */
  const abortAllRequests = useCallback(() => {
    requestControllersRef.current.forEach((controller) => controller.abort());
    requestControllersRef.current.clear();
    requestPromisesRef.current.clear();
    setPendingServices(new Set());
  }, []);

  /**
   * 将翻译结果合并到当前会话的缓存中。
   * 使用函数式 setState 更新，确保基于最新 session 值合并。
   */
  const mergeResultsIntoSession = useCallback((translationResults: TranslationResultItem[]) => {
    const decodedMap = mapResultsByService(decodeResults(translationResults));

    setSession((prev) => {
      if (!prev) return prev;

      const updated = {
        ...prev,
        cachedResultsByService: {
          ...prev.cachedResultsByService,
          ...decodedMap,
        },
      };

      // 同步更新 ref，供异步回调读取最新值
      sessionRef.current = updated;
      return updated;
    });
  }, []);

  /** 重置翻译会话：中止所有请求并建立新的会话上下文 */
  const resetSession = useCallback(
    (text: string, translationDirection: TranslationDirection) => {
      abortAllRequests();

      const newSession: PopupTranslationSession = {
        sessionKey: buildTranslationSessionKey(text, translationDirection),
        text,
        direction: translationDirection,
        cachedResultsByService: {},
      };

      setSession(newSession);
      sessionRef.current = newSession;
    },
    [abortAllRequests],
  );

  /** 对单个翻译服务发起请求，支持去重（同一服务不会重复发起） */
  const requestServiceResult = useCallback(
    (
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

      // 标记服务为 pending 状态
      setPendingServices((prev) => {
        const next = new Set(prev);
        next.add(service);
        return next;
      });

      const sessionKey = buildTranslationSessionKey(text, translationDirection);
      const requestPromise = translateWithService(
        text,
        service,
        translationDirection,
        controller.signal,
      )
        .then((result) => {
          // 仅当 session 未变更时才合并结果（防止过期响应写入新 session）
          if (sessionRef.current?.sessionKey === sessionKey) {
            mergeResultsIntoSession([result]);
          }

          return result;
        })
        .finally(() => {
          // 清理 AbortController 引用
          const currentController = requestControllersRef.current.get(service);
          if (currentController?.signal === controller.signal) {
            requestControllersRef.current.delete(service);
          }

          // 清理 Promise 引用
          if (requestPromisesRef.current.get(service) === requestPromise) {
            requestPromisesRef.current.delete(service);
          }

          // 从 pending 集合中移除
          setPendingServices((prev) => {
            const next = new Set(prev);
            next.delete(service);
            return next;
          });
        });

      requestPromisesRef.current.set(service, requestPromise);
      return requestPromise;
    },
    [mergeResultsIntoSession],
  );

  /** 执行翻译：管理会话生命周期，并行调用多个翻译服务 */
  const runTranslation = useCallback(
    async (
      text: string,
      services: TranslationServiceId[],
      translationDirection: TranslationDirection,
      forceRefresh: boolean,
    ): Promise<void> => {
      const trimmedText = text.trim();
      if (!trimmedText || services.length === 0) {
        return;
      }

      const sessionKey = buildTranslationSessionKey(trimmedText, translationDirection);
      const currentSession = sessionRef.current;
      const isSameSession = currentSession?.sessionKey === sessionKey;

      if (!isSameSession || forceRefresh) {
        resetSession(trimmedText, translationDirection);
      }

      const latestSession = sessionRef.current;
      if (!latestSession) {
        return;
      }

      const servicesToRequest =
        forceRefresh || !isSameSession
          ? services
          : services.filter(
              (service) =>
                !latestSession.cachedResultsByService[service] &&
                !requestPromisesRef.current.has(service),
            );

      if (servicesToRequest.length === 0) {
        return;
      }

      await Promise.all(
        servicesToRequest.map((service) =>
          requestServiceResult(trimmedText, translationDirection, service),
        ),
      );
    },
    [resetSession, requestServiceResult],
  );

  /** 重试单个翻译服务：清除该服务的缓存结果后重新请求 */
  const retryService = useCallback(
    async (service: TranslationServiceId): Promise<void> => {
      const currentSession = sessionRef.current;
      if (!currentSession || requestPromisesRef.current.has(service)) {
        return;
      }

      // 从缓存中移除该服务的旧结果
      setSession((prev) => {
        if (!prev) return prev;

        const { [service]: _removedResult, ...remainingResults } = prev.cachedResultsByService;
        const updated = { ...prev, cachedResultsByService: remainingResults };
        sessionRef.current = updated;
        return updated;
      });

      await requestServiceResult(currentSession.text, currentSession.direction, service);
    },
    [requestServiceResult],
  );

  /**
   * 获取当前会话中已缓存的翻译结果，按 selectedServices 顺序排列。
   * 直接读取 session state，React Compiler 可以正确追踪依赖。
   */
  const getCurrentResults = useCallback(
    (selectedServices: TranslationServiceId[]) => {
      if (!session) {
        return [];
      }
      return orderResultsByServices(session.cachedResultsByService, selectedServices);
    },
    [session],
  );

  /** 获取当前仍在等待响应的翻译服务列表 */
  const getCurrentPendingServices = useCallback(
    (selectedServices: TranslationServiceId[]) => {
      return selectedServices.filter((service) => pendingServices.has(service));
    },
    [pendingServices],
  );

  return {
    runTranslation,
    retryService,
    abortAllRequests,
    getCurrentResults,
    getCurrentPendingServices,
    isAbortError,
  };
};
