import type { TranslationResultItem } from "./translation";

/** Decodes HTML entities (e.g. &amp;, &lt;) that translation APIs sometimes return */
export const decodeHtmlEntities = (text: string): string => {
  const doc = new DOMParser().parseFromString(text, "text/html");
  return doc.documentElement.textContent || text;
};

/** Applies HTML entity decoding to all successful translation results */
export const decodeResults = (results: TranslationResultItem[]): TranslationResultItem[] =>
  results.map((result) =>
    result.status === "success" && result.contentFormat !== "html"
      ? { ...result, translation: decodeHtmlEntities(result.translation) }
      : result,
  );
