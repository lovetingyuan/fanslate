interface ImportMetaEnv {
  readonly WXT_GOOGLE_HTML_API_KEY?: string;
  readonly WXT_OPENROUTER_API_KEY?: string;
  readonly WXT_OPENROUTER_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
