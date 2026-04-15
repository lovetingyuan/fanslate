import { TranslationDialog } from "./components/TranslationDialog";
import { browser } from "wxt/browser";
import type { TranslationDirection, TranslationResultItem } from "../utils/translation";
import {
  normalizeTranslationSourcePayload,
  type TranslationSourcePayload,
} from "../utils/richText";
import { extractFormattedSelection } from "../utils/richTextDom";

/**
 * Messages sent from background script to content script.
 * Each variant corresponds to a distinct UI action in the TranslationDialog.
 */
type ContentScriptMessage =
  | { action: "showLoadingDialog"; source: TranslationSourcePayload }
  | {
      action: "updateDetailDialog";
      results: TranslationResultItem[];
      direction: TranslationDirection;
    }
  | { action: "updateDetailDialogError"; message: string }
  | {
      action: "showDetailDialog";
      source: TranslationSourcePayload;
      results: TranslationResultItem[];
      direction: TranslationDirection;
    }
  | { action: "showErrorDialog"; message: string };

type ContentScriptRequest = {
  action: "getSelectionPayload";
};

/** Type guard to validate incoming messages from background script */
const isContentScriptMessage = (msg: unknown): msg is ContentScriptMessage => {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (typeof m.action !== "string") return false;
  switch (m.action) {
    case "showLoadingDialog":
      return normalizeTranslationSourcePayload(m.source) !== null;
    case "updateDetailDialog":
      return Array.isArray(m.results) && typeof m.direction === "string";
    case "updateDetailDialogError":
      return typeof m.message === "string";
    case "showDetailDialog":
      return (
        normalizeTranslationSourcePayload(m.source) !== null &&
        Array.isArray(m.results) &&
        typeof m.direction === "string"
      );
    case "showErrorDialog":
      return typeof m.message === "string";
    default:
      return false;
  }
};

const isContentScriptRequest = (msg: unknown): msg is ContentScriptRequest => {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m.action === "getSelectionPayload";
};

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  main() {
    if (import.meta.env.DEV) console.log("Translation content script loaded.");

    let lastSelectionKey = "";
    let dialogInstance: TranslationDialog | null = null;
    let selectionChangeTimer: ReturnType<typeof setTimeout> | null = null;

    const handleSelectionChange = () => {
      const selectionPayload = extractFormattedSelection(window.getSelection());
      const selectionKey = selectionPayload
        ? `${selectionPayload.plainText}::${selectionPayload.sanitizedHtml ?? ""}`
        : "";

      if (selectionPayload && selectionKey !== lastSelectionKey) {
        lastSelectionKey = selectionKey;
        browser.runtime
          .sendMessage({
            action: "updateSelectionPayload",
            selection: selectionPayload,
          })
          .catch((err) => {
            if (import.meta.env.DEV) console.error("发送更新菜单消息失败:", err);
          });
      } else if (!selectionPayload && lastSelectionKey) {
        setTimeout(() => {
          const nextSelectionPayload = extractFormattedSelection(window.getSelection());
          if (!nextSelectionPayload && lastSelectionKey) {
            lastSelectionKey = "";
            browser.runtime
              .sendMessage({
                action: "clearSelectionPayload",
              })
              .catch((err) => {
                if (import.meta.env.DEV) console.error("发送重置菜单消息失败:", err);
              });
          }
        }, 100);
      }
    };

    /** Debounced version for selectionchange events to avoid flooding the background script */
    const handleSelectionChangeDebounced = () => {
      if (selectionChangeTimer) clearTimeout(selectionChangeTimer);
      selectionChangeTimer = setTimeout(handleSelectionChange, 200);
    };

    document.addEventListener("mouseup", handleSelectionChange);
    document.addEventListener("selectionchange", handleSelectionChangeDebounced);

    /**
     * Helper to get or create the translation dialog instance
     */
    const getOrCreateDialog = (): TranslationDialog => {
      if (!dialogInstance) {
        dialogInstance = new TranslationDialog();
        dialogInstance.onClose = () => {
          // Wait for selection to be restored
          setTimeout(handleSelectionChange, 100);
        };
      }
      return dialogInstance;
    };

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (isContentScriptRequest(message)) {
        sendResponse({ success: true, selection: extractFormattedSelection(window.getSelection()) });
        return false;
      }

      if (!isContentScriptMessage(message)) {
        sendResponse({ success: false });
        return false;
      }

      if (import.meta.env.DEV) console.log("Content script received message:", message.action);

      const dialog = getOrCreateDialog();

      switch (message.action) {
        case "showLoadingDialog":
          dialog.showLoading(message.source);
          break;
        case "updateDetailDialog":
          dialog.updateIncremental(message.results, message.direction);
          break;
        case "updateDetailDialogError":
          dialog.updateError(message.message);
          break;
        case "showDetailDialog":
          dialog.showDetail(message.source, message.results, message.direction);
          break;
        case "showErrorDialog":
          dialog.showError(message.message);
          break;
      }

      sendResponse({ success: true });
      return false;
    });
  },
});
