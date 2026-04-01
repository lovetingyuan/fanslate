import {
  CheckIcon,
  CopyIcon,
  ErrorIcon,
  RetryIcon,
  SpeakerIcon,
  StopIcon,
} from "../../components/icons";
import {
  getServiceLabel,
  type TranslationResultItem,
  type TranslationServiceId,
} from "../../../utils/translation";

interface ResultCardProps {
  result?: TranslationResultItem;
  service: TranslationServiceId;
  copiedService: TranslationServiceId | null;
  speakingService: TranslationServiceId | null;
  onRetry: (service: TranslationServiceId) => void;
  onCopy: (service: TranslationServiceId, text: string) => void;
  onSpeak: (result: TranslationResultItem) => void;
}

export const ResultCard = ({
  result,
  service,
  copiedService,
  speakingService,
  onRetry,
  onCopy,
  onSpeak,
}: ResultCardProps) => {
  if (!result) {
    return (
      <div className="card bg-base-200 shadow-inner border border-base-300 overflow-hidden rounded-xl">
        <div className="card-body p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="badge badge-primary badge-xs badge-outline opacity-60">
                {getServiceLabel(service)}
              </div>
            </div>
          </div>
          <div className="flex items-center text-sm opacity-70" aria-label="正在获取翻译结果">
            <span className="loading loading-spinner loading-xs"></span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card bg-base-200 shadow-inner border border-base-300 overflow-hidden rounded-xl">
      <div className="card-body p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="badge badge-primary badge-xs badge-outline opacity-60">
              {result.serviceLabel}
            </div>
          </div>
          <div className="flex gap-1">
            {result.status === "error" ? (
              <button
                className="btn btn-ghost btn-xs btn-circle min-h-0 h-6 w-6 p-0"
                onClick={() => onRetry(result.service)}
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
                  onClick={() => onSpeak(result)}
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
                  onClick={() => onCopy(result.service, result.translation)}
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
};
