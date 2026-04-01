import { ResultCard } from "./ResultCard";
import type { TranslationResultItem, TranslationServiceId } from "../../../utils/translation";

interface ResultListProps {
  results: TranslationResultItem[];
  pendingServices: TranslationServiceId[];
  selectedServices: TranslationServiceId[];
  copiedService: TranslationServiceId | null;
  speakingService: TranslationServiceId | null;
  onRetry: (service: TranslationServiceId) => void;
  onCopy: (service: TranslationServiceId, text: string) => void;
  onSpeak: (result: TranslationResultItem) => void;
}

export const ResultList = ({
  results,
  pendingServices,
  selectedServices,
  copiedService,
  speakingService,
  onRetry,
  onCopy,
  onSpeak,
}: ResultListProps) => {
  const resultMap = new Map(results.map((result) => [result.service, result]));
  const pendingServiceSet = new Set(pendingServices);
  const visibleServices = selectedServices.filter(
    (service) => resultMap.has(service) || pendingServiceSet.has(service),
  );

  if (visibleServices.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {visibleServices.map((service) => {
        const result = resultMap.get(service);
        return (
          <ResultCard
            key={service}
            result={result}
            service={service}
            copiedService={copiedService}
            speakingService={speakingService}
            onRetry={onRetry}
            onCopy={onCopy}
            onSpeak={onSpeak}
          />
        );
      })}
    </div>
  );
};
