import { useEffect, useState } from "react";

type PopupTheme = "light" | "dracula";

export const useTheme = () => {
  const [theme, setTheme] = useState<PopupTheme>("light");

  useEffect(() => {
    const loadTheme = async () => {
      const storage = await browser.storage.local.get(["theme"]);
      const nextTheme = storage.theme === "dracula" ? "dracula" : "light";
      setTheme(nextTheme);
      document.documentElement.setAttribute("data-theme", nextTheme);
    };

    void loadTheme();
  }, []);

  const toggleTheme = async () => {
    const nextTheme: PopupTheme = theme === "light" ? "dracula" : "light";
    setTheme(nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
    await browser.storage.local.set({ theme: nextTheme });
  };

  return { theme, toggleTheme };
};
