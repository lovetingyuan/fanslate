import { useEffect, useState } from "react";

interface SettingsProps {
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export default function Settings({ onClose, onSaved }: SettingsProps) {
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    const loadSettings = async () => {
      const res = await browser.storage.local.get(["openRouterApiKey", "openRouterModelId"]);

      if (res.openRouterApiKey) setApiKey(res.openRouterApiKey as string);
      if (res.openRouterModelId) setModelId(res.openRouterModelId as string);
    };

    void loadSettings();
  }, []);

  const handleSave = async () => {
    try {
      setSaveError("");
      await browser.storage.local.set({
        openRouterApiKey: apiKey,
        openRouterModelId: modelId,
      });
      await onSaved();
      onClose();
    } catch (error: unknown) {
      setSaveError(error instanceof Error ? error.message : "保存设置失败");
    }
  };

  return (
    <div className="absolute inset-0 bg-base-100 z-50 flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-base-300">
        <h2 className="text-base font-semibold opacity-80">设置</h2>
        <div className="flex gap-2">
          <button
            className="btn btn-xs btn-soft min-h-7 h-7 px-2.5 text-primary"
            onClick={handleSave}
          >
            保存
          </button>
          <button className="btn btn-xs btn-ghost min-h-7 h-7 px-2.5 font-normal" onClick={onClose}>
            返回
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4 flex-1 overflow-y-auto">
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
            onChange={(e) => setApiKey(e.target.value)}
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
            onChange={(e) => setModelId(e.target.value)}
          />
        </div>
        {saveError && <p className="text-xs text-error">{saveError}</p>}
      </div>
    </div>
  );
}
