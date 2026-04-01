import { useCallback, useEffect, useRef, useState } from "react";
import {
  getTranslationServicePreferences,
  setSelectedServices as persistSelectedServices,
  type TranslationServiceId,
  type TranslationServiceOption,
} from "../../../utils/translation";

export const useServicePreferences = () => {
  const [selectedServices, setSelectedServices] = useState<TranslationServiceId[]>([]);
  const [visibleServiceOptions, setVisibleServiceOptions] = useState<TranslationServiceOption[]>(
    [],
  );
  const selectedServicesRef = useRef<TranslationServiceId[]>([]);

  /** 从存储中加载翻译服务偏好设置，并同步到状态和 ref */
  const refreshServicePreferences = useCallback(async () => {
    const preferences = await getTranslationServicePreferences();
    setSelectedServices(preferences.selectedServices);
    setVisibleServiceOptions(preferences.visibleServiceOptions);
    selectedServicesRef.current = preferences.selectedServices;
    return preferences;
  }, []);

  /** 切换单个翻译服务的选中状态，并持久化到存储 */
  const toggleService = useCallback(async (service: TranslationServiceId) => {
    const nextServices = selectedServicesRef.current.includes(service)
      ? selectedServicesRef.current.filter((item) => item !== service)
      : [...selectedServicesRef.current, service];

    setSelectedServices(nextServices);
    selectedServicesRef.current = nextServices;
    await persistSelectedServices(nextServices);

    return nextServices;
  }, []);

  useEffect(() => {
    selectedServicesRef.current = selectedServices;
  }, [selectedServices]);

  return {
    selectedServices,
    visibleServiceOptions,
    selectedServicesRef,
    refreshServicePreferences,
    toggleService,
  };
};
