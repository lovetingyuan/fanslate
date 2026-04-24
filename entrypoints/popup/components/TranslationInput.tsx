import type { RefObject } from "react";
import type { TranslationDirection } from "../../../utils/translation";

interface TranslationInputProps {
  value: string;
  targetLang: TranslationDirection;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

export const TranslationInput = ({
  value,
  targetLang,
  textareaRef,
  onChange,
  onKeyDown,
}: TranslationInputProps) => {
  return (
    <div className="form-control">
      <textarea
        autoFocus
        ref={textareaRef}
        className="textarea textarea-bordered w-full h-28 resize-y transition-colors"
        placeholder={`输入要翻译的文字到${targetLang === "zh" ? "中文" : "英文"}... (Shift+Enter 快速翻译)`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
};
