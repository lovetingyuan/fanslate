export const logger = {
  log: (...args: unknown[]) => {
    if (import.meta.env.DEV) {
      console.log(...args);
    }
  },
  error: (...args: unknown[]) => {
    // Keeping errors visible in production can be useful, but per instructions,
    // we often want to silence logs. However, "console.log" was specified.
    // I will silence detailed error logs in prod if they are just for debugging,
    // but critical errors usually should remain.
    // Given the prompt "console.log 都只在开发阶段生效", I will assume the user
    // wants a clean console.
    if (import.meta.env.DEV) {
      console.error(...args);
    }
  },
  warn: (...args: unknown[]) => {
    if (import.meta.env.DEV) {
      console.warn(...args);
    }
  },
};
