import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import packageJson from "./package.json";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  webExt: {
    startUrls: ["https://tingyuan.in"],
  },
  manifest: {
    name: "中英直译",
    description:
      "A browser extension for bidirectional Chinese-English translation via context menus.",
    permissions: ["contextMenus", "storage"],
    host_permissions: ["*://*/*"],
    action: {
      default_popup: "popup.html",
    },
    version_name: packageJson.version,
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval' http://localhost:3000 http://localhost:3001; object-src 'self'",
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
    },
    server: {
      hmr: {
        port: 3000,
      },
    },
  }),
});
