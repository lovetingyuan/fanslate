import { useCallback, useEffect, useState } from "react";
import type { TranslationResultItem, TranslationServiceId } from "../../../utils/translation";

export const useSpeech = () => {
  const [speakingService, setSpeakingService] = useState<TranslationServiceId | null>(null);

  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  const handleSpeak = useCallback(
    (result: TranslationResultItem) => {
      if (result.status !== "success" || !result.translation) {
        return;
      }

      if (speakingService === result.service) {
        window.speechSynthesis.cancel();
        setSpeakingService(null);
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(result.translation);
      // direction is the target language, so the translated text IS in that language
      utterance.lang = result.direction === "zh" ? "zh-CN" : "en-US";
      utterance.onstart = () => setSpeakingService(result.service);
      utterance.onend = () => setSpeakingService(null);
      utterance.onerror = () => setSpeakingService(null);

      window.speechSynthesis.speak(utterance);
    },
    [speakingService],
  );

  /** 停止当前语音播放并重置状态 */
  const stopSpeaking = useCallback(() => {
    window.speechSynthesis.cancel();
    setSpeakingService(null);
  }, []);

  return { speakingService, handleSpeak, stopSpeaking };
};
