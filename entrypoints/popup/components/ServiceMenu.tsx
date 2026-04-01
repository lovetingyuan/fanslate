import { useEffect, useRef } from "react";
import {
  getSelectedServicesSummary,
  type TranslationServiceOption,
} from "../../../utils/translation";
import type { TranslationServiceId } from "../../../utils/translation";

interface ServiceMenuProps {
  isOpen: boolean;
  selectedServices: TranslationServiceId[];
  visibleServiceOptions: TranslationServiceOption[];
  onToggle: () => void;
  onServiceToggle: (service: TranslationServiceId) => void;
  onClose: () => void;
}

export const ServiceMenu = ({
  isOpen,
  selectedServices,
  visibleServiceOptions,
  onToggle,
  onServiceToggle,
  onClose,
}: ServiceMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [onClose]);

  return (
    <div ref={menuRef} className="dropdown dropdown-bottom relative w-36 shrink-0">
      <button
        type="button"
        className="btn btn-outline btn-primary btn-xs h-8 min-h-8 w-full justify-between px-3"
        onClick={onToggle}
      >
        <span className="truncate text-xs font-normal text-neutral-800 dark:text-neutral-200">
          {getSelectedServicesSummary(selectedServices)}
        </span>
        <span className={`text-xs transition-transform ${isOpen ? "rotate-180" : ""}`}>▼</span>
      </button>
      {isOpen && (
        <div className="absolute left-0 top-full z-30 mt-2 w-38 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg space-y-1">
          {visibleServiceOptions.map((serviceOption) => {
            const isSelected = selectedServices.includes(serviceOption.id);
            return (
              <button
                key={serviceOption.id}
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1 text-left hover:bg-base-200"
                aria-pressed={isSelected}
                onClick={() => onServiceToggle(serviceOption.id)}
              >
                <span
                  className={`w-4 text-center text-sm font-semibold ${
                    isSelected ? "text-primary" : "opacity-0"
                  }`}
                  aria-hidden="true"
                >
                  ✓
                </span>
                <span className="label-text flex-1">{serviceOption.label}</span>
              </button>
            );
          })}
          {selectedServices.length === 0 && (
            <p className="px-2 pt-1 text-xs text-error">至少选择一个翻译服务</p>
          )}
        </div>
      )}
    </div>
  );
};
