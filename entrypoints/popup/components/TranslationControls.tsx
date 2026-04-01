import { ServiceMenu } from "./ServiceMenu";
import type {
  TranslationDirection,
  TranslationServiceId,
  TranslationServiceOption,
} from "../../../utils/translation";

interface TranslationControlsProps {
  isLoading: boolean;
  inputText: string;
  targetLang: TranslationDirection;
  selectedServices: TranslationServiceId[];
  visibleServiceOptions: TranslationServiceOption[];
  isServiceMenuOpen: boolean;
  onTranslate: () => void;
  onLanguageChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onServiceMenuToggle: () => void;
  onServiceToggle: (service: TranslationServiceId) => void;
  onServiceMenuClose: () => void;
}

export const TranslationControls = ({
  isLoading,
  inputText,
  targetLang,
  selectedServices,
  visibleServiceOptions,
  isServiceMenuOpen,
  onTranslate,
  onLanguageChange,
  onServiceMenuToggle,
  onServiceToggle,
  onServiceMenuClose,
}: TranslationControlsProps) => {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          className="btn btn-outline btn-primary btn-xs h-8 min-h-8 min-w-0 flex-1 px-4"
          onClick={onTranslate}
          disabled={!inputText.trim() || selectedServices.length === 0}
        >
          {isLoading ? <span className="loading loading-spinner loading-sm"></span> : "翻译"}
        </button>
        <ServiceMenu
          isOpen={isServiceMenuOpen}
          selectedServices={selectedServices}
          visibleServiceOptions={visibleServiceOptions}
          onToggle={onServiceMenuToggle}
          onServiceToggle={onServiceToggle}
          onClose={onServiceMenuClose}
        />
        <label
          className="btn btn-outline btn-secondary btn-xs h-8 min-h-8 w-12 px-0 swap swap-flip shrink-0"
          title="切换目标语言"
        >
          <input type="checkbox" checked={targetLang === "zh"} onChange={onLanguageChange} />
          <span className="swap-on text-xs font-semibold">中</span>
          <span className="swap-off text-xs font-semibold">EN</span>
        </label>
      </div>
      {selectedServices.length === 0 && <p className="text-xs text-error">至少选择一个翻译服务</p>}
    </div>
  );
};
