import { useEffect, useState } from "react";
import {
  getTranslationServicePreferences,
  setHiddenServices as persistHiddenServices,
  TRANSLATION_SERVICE_OPTIONS,
  type TranslationServiceId,
} from "../../utils/translation";

interface SettingsProps {
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export default function Settings({ onClose, onSaved }: SettingsProps) {
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [hiddenServices, setHiddenServices] = useState<TranslationServiceId[]>([]);
  const [serviceError, setServiceError] = useState("");

  useEffect(() => {
    Promise.all([
      browser.storage.local.get(["openRouterApiKey", "openRouterModelId"]),
      getTranslationServicePreferences(),
    ]).then(([res, preferences]) => {
      if (res.openRouterApiKey) setApiKey(res.openRouterApiKey as string);
      if (res.openRouterModelId) setModelId(res.openRouterModelId as string);
      setHiddenServices(preferences.hiddenServices);
    });
  }, []);

  const handleServiceVisibilityToggle = (service: TranslationServiceId) => {
    const nextHiddenServices = hiddenServices.includes(service)
      ? hiddenServices.filter((item) => item !== service)
      : [...hiddenServices, service];

    if (nextHiddenServices.length >= TRANSLATION_SERVICE_OPTIONS.length) {
      setServiceError("至少保留一个可见翻译服务");
      return;
    }

    setHiddenServices(nextHiddenServices);
    setServiceError("");
  };

  const handleSave = async () => {
    try {
      await browser.storage.local.set({
        openRouterApiKey: apiKey,
        openRouterModelId: modelId,
      });
      await persistHiddenServices(hiddenServices);
      await onSaved();
      onClose();
    } catch (error: unknown) {
      setServiceError(error instanceof Error ? error.message : "保存设置失败");
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
          {/* <label className="label">
            <span className="label-text-alt text-xs opacity-60">优先使用此Key，未设置则使用默认值</span>
          </label> */}
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
          {/* <label className="label">
            <span className="label-text-alt text-xs opacity-60">例如: google/gemini-2.0-flash-exp:free</span>
          </label> */}
        </div>

        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">服务商显示</h3>
            <p className="mt-1 text-xs opacity-70">隐藏后的服务商不会出现在翻译服务选择器中。</p>
          </div>
          <div className="space-y-2">
            {TRANSLATION_SERVICE_OPTIONS.map((service) => {
              const visible = !hiddenServices.includes(service.id);
              return (
                <label
                  key={service.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-base-300 bg-base-200/60 px-3 py-2 cursor-pointer"
                >
                  <div>
                    <div className="text-sm font-medium">{service.label}</div>
                    <div className="text-xs opacity-60">{visible ? "显示中" : "已隐藏"}</div>
                  </div>
                  <input
                    type="checkbox"
                    className="toggle toggle-primary toggle-sm"
                    checked={visible}
                    onChange={() => handleServiceVisibilityToggle(service.id)}
                  />
                </label>
              );
            })}
          </div>
          {serviceError && <p className="text-xs text-error">{serviceError}</p>}
        </div>
      </div>
    </div>
  );
}
