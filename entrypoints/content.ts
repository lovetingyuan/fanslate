import { TranslationDialog } from "./components/TranslationDialog";

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  main() {
    if (import.meta.env.DEV) console.log("Translation content script loaded.");

    let lastSelectedText = "";
    let dialogInstance: TranslationDialog | null = null;

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

    document.addEventListener("mouseup", handleSelectionChange);
    document.addEventListener("selectionchange", handleSelectionChange);

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

    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (import.meta.env.DEV) console.log("Content script received message:", message.action);

      const dialog = getOrCreateDialog();

      if (message.action === "showLoadingDialog") {
        dialog.showLoading(message.originalText);
      } else if (message.action === "updateDetailDialog") {
        dialog.updateSuccess(message.results, message.direction);
      } else if (message.action === "updateDetailDialogError") {
        dialog.updateError(message.message);
      } else if (message.action === "showDetailDialog") {
        dialog.showDetail(message.originalText, message.results, message.direction);
      } else if (message.action === "showErrorDialog") {
        dialog.showError(message.message);
      }

      sendResponse({ success: true });
      return false;
    });
  },
});
