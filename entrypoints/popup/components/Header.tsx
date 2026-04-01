import { MoonIcon, SettingsIcon, SunIcon } from "../../components/icons";

interface HeaderProps {
  theme: "light" | "dracula";
  onToggleTheme: () => void;
  onOpenSettings: () => void;
}

export const Header = ({ theme, onToggleTheme, onOpenSettings }: HeaderProps) => {
  return (
    <div className="flex items-center justify-between px-4 pb-3 pt-4 shrink-0">
      <div className="flex items-center gap-2">
        <img src="/icon/32.png" alt="中英直译助手 logo" className="h-6 w-6 rounded-md shadow-sm" />
        <span className="text-base font-semibold opacity-80">中英直译助手</span>
      </div>
      <div className="flex gap-1">
        <button
          className="btn btn-ghost btn-circle btn-xs"
          onClick={onToggleTheme}
          title="切换主题"
        >
          {theme === "light" ? <SunIcon className="h-3 w-3" /> : <MoonIcon className="h-3 w-3" />}
        </button>
        <button className="btn btn-ghost btn-circle btn-xs" onClick={onOpenSettings} title="设置">
          <SettingsIcon className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
};
