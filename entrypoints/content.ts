import { TranslationDialog } from "./components/TranslationDialog";
import type { TranslationDirection, TranslationResultItem } from "../utils/translation";

/**
 * Messages sent from background script to content script.
 * Each variant corresponds to a distinct UI action in the TranslationDialog.
 */
type ContentScriptMessage =
  | { action: "showLoadingDialog"; originalText: string }
  | {
      action: "updateDetailDialog";
      results: TranslationResultItem[];
      direction: TranslationDirection;
    }
  | { action: "updateDetailDialogError"; message: string }
  | {
      action: "showDetailDialog";
      originalText: string;
      results: TranslationResultItem[];
      direction: TranslationDirection;
    }
  | { action: "showErrorDialog"; message: string };

/** Type guard to validate incoming messages from background script */
const isContentScriptMessage = (msg: unknown): msg is ContentScriptMessage => {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (typeof m.action !== "string") return false;
  switch (m.action) {
    case "showLoadingDialog":
      return typeof m.originalText === "string";
    case "updateDetailDialog":
      return Array.isArray(m.results) && typeof m.direction === "string";
    case "updateDetailDialogError":
      return typeof m.message === "string";
    case "showDetailDialog":
      return (
        typeof m.originalText === "string" &&
        Array.isArray(m.results) &&
        typeof m.direction === "string"
      );
    case "showErrorDialog":
      return typeof m.message === "string";
    default:
      return false;
  }
};

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  main() {
    if (import.meta.env.DEV) console.log("Translation content script loaded.");

    let lastSelectedText = "";
    let dialogInstance: TranslationDialog | null = null;
    let selectionChangeTimer: ReturnType<typeof setTimeout> | null = null;

    const handleSelectionChange = () => {
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();

      if (selectedText && selectedText !== lastSelectedText && selectedText.length < 200) {
        lastSelectedText = selectedText;
        browser.runtime
          .sendMessage({
            action: "updateMenuTitle",
            text: selectedText,
          })
          .catch((err) => {
            if (import.meta.env.DEV) console.error("发送更新菜单消息失败:", err);
          });
      } else if (!selectedText && lastSelectedText) {
        setTimeout(() => {
          const newSelection = window.getSelection();
          const newSelectedText = newSelection?.toString().trim();
          if (!newSelectedText && lastSelectedText) {
            lastSelectedText = "";
            browser.runtime
              .sendMessage({
                action: "resetMenuTitle",
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
      if (!isContentScriptMessage(message)) {
        sendResponse({ success: false });
        return false;
      }

      if (import.meta.env.DEV) console.log("Content script received message:", message.action);

      const dialog = getOrCreateDialog();

      switch (message.action) {
        case "showLoadingDialog":
          dialog.showLoading(message.originalText);
          break;
        case "updateDetailDialog":
          dialog.updateIncremental(message.results, message.direction);
          break;
        case "updateDetailDialogError":
          dialog.updateError(message.message);
          break;
        case "showDetailDialog":
          dialog.showDetail(message.originalText, message.results, message.direction);
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
