import { useEffect, useState } from "react";
import { BackIcon } from "../components/icons";

interface SettingsProps {
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export default function Settings({ onClose, onSaved }: SettingsProps) {
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [deeplApiKey, setDeeplApiKey] = useState("");
  const [keepUntranslatedInput, setKeepUntranslatedInput] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      const res = await browser.storage.local.get([
        "openRouterApiKey",
        "openRouterModelId",
        "deeplApiKey",
        "keepUntranslatedInput",
      ]);

      if (res.openRouterApiKey) setApiKey(res.openRouterApiKey as string);
      if (res.openRouterModelId) setModelId(res.openRouterModelId as string);
      if (res.deeplApiKey) setDeeplApiKey(res.deeplApiKey as string);
      if (res.keepUntranslatedInput) setKeepUntranslatedInput(res.keepUntranslatedInput as boolean);
    };

    void loadSettings();
  }, []);

  const handleBack = async () => {
    await onSaved();
    onClose();
  };

  return (
    <div className="absolute inset-0 bg-base-100 z-50 flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-base-300">
        <button
          className="btn btn-ghost btn-circle btn-xs"
          onClick={() => void handleBack()}
          title="返回"
        >
          <BackIcon className="h-4 w-4" />
        </button>
        <h2 className="text-base font-semibold opacity-80">设置</h2>
      </div>

      <div className="p-4 space-y-4 flex-1 overflow-y-auto">
        <div className="form-control w-full">
          <label className="label">
            <span className="label-text font-medium mb-1">DeepL API Key</span>
            <a
              href="https://www.deepl.com/zh/your-account/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="label-text-alt link link-primary mb-1"
            >
              Get Key ↗
            </a>
          </label>
          <input
            type="text"
            placeholder="deepl-api-key"
            className="input input-bordered input-sm w-full"
            value={deeplApiKey}
            onChange={(e) => {
              setDeeplApiKey(e.target.value);
              void browser.storage.local.set({ deeplApiKey: e.target.value });
            }}
          />
        </div>

        <div className="form-control w-full">
          <label className="label">
            <span className="label-text font-medium mb-1">OpenRouter API Key</span>
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="label-text-alt link link-primary mb-1"
            >
              Get Key ↗
            </a>
          </label>
          <input
            type="text"
            placeholder="sk-or-..."
            className="input input-bordered input-sm w-full"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              void browser.storage.local.set({ openRouterApiKey: e.target.value });
            }}
          />
        </div>

        <div className="form-control w-full">
          <label className="label">
            <span className="label-text font-medium mb-1">OpenRouter Model ID</span>
            <a
              href="https://openrouter.ai/models"
              target="_blank"
              rel="noopener noreferrer"
              className="label-text-alt link link-primary mb-1"
            >
              Models ↗
            </a>
          </label>
          <input
            type="text"
            placeholder="openrouter/free"
            className="input input-bordered input-sm w-full"
            value={modelId}
            onChange={(e) => {
              setModelId(e.target.value);
              void browser.storage.local.set({ openRouterModelId: e.target.value });
            }}
          />
        </div>

        <div className="form-control w-full">
          <label className="label cursor-pointer gap-3">
            <span className="label-text font-medium">在输入框中保留尚未翻译的文本</span>
            <input
              type="checkbox"
              className="toggle toggle-sm toggle-primary"
              checked={keepUntranslatedInput}
              onChange={(e) => {
                setKeepUntranslatedInput(e.target.checked);
                void browser.storage.local.set({ keepUntranslatedInput: e.target.checked });
              }}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
