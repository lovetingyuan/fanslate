import { GithubIcon } from "../../components/icons";

export const Footer = () => {
  return (
    <footer className="px-4 py-2 bg-base-200 text-base-content border-t border-base-300 shrink-0 flex justify-between items-center">
      <p className="text-[10px] opacity-60">
        V{__APP_VERSION__} &copy; {new Date().getFullYear()}
        <a href="https://translate-extension.tingyuan.in" target="_blank" className="ml-1 link">
          Translate Extension
        </a>
      </p>
      <a
        href="https://github.com/lovetingyuan/translate-extension"
        target="_blank"
        rel="noopener noreferrer"
        title="Github"
        className="hover:text-primary transition-colors opacity-50 hover:opacity-100 flex items-center"
      >
        <GithubIcon className="h-3.5 w-3.5" />
      </a>
    </footer>
  );
};
