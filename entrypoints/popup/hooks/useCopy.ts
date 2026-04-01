import { useState } from "react";
import type { TranslationServiceId } from "../../../utils/translation";

export const useCopy = () => {
  const [copiedService, setCopiedService] = useState<TranslationServiceId | null>(null);

  const handleCopy = async (service: TranslationServiceId, text: string) => {
    if (!text) {
      return;
    }

    await navigator.clipboard.writeText(text);
    setCopiedService(service);
    window.setTimeout(
      () => setCopiedService((current) => (current === service ? null : current)),
      2000,
    );
  };

  return { copiedService, handleCopy };
};
