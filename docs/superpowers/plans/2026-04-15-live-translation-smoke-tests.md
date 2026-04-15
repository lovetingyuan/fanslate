# Live Translation Smoke Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real translation-service smoke tests that verify `apple` translates to `苹果`, read required secrets from environment variables, and run automatically before every zip command.

**Architecture:** Extract the provider request logic that currently lives inside the browser-extension translation module into a shared service layer that can run in both the extension and Node-based tests. Use a Vitest-powered smoke test suite to call each provider with a fixed input and assert the normalized output. Gate `zip` and `zip:firefox` behind that suite so packaging always proves provider availability first.

**Tech Stack:** TypeScript, Vitest, Node.js environment variables, existing WXT extension code

---

### Task 1: Add Test Harness And First Failing Smoke Test

**Files:**
- Modify: `D:\lovetingyuan\fanslate\package.json`
- Create: `D:\lovetingyuan\fanslate\vitest.config.ts`
- Create: `D:\lovetingyuan\fanslate\tests\translation-services.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'

describe('translation services smoke tests', () => {
  it('google translates apple to 苹果', async () => {
    const result = await runTranslationSmokeTest('google')
    expect(result).toBe('苹果')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:translations -- --runInBand`
Expected: FAIL because `runTranslationSmokeTest` and the Vitest setup do not exist yet.

- [ ] **Step 3: Write minimal implementation scaffolding**

```json
{
  "scripts": {
    "test:translations": "vitest run tests/translation-services.test.ts"
  },
  "devDependencies": {
    "vitest": "^3.2.4"
  }
}
```

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  },
})
```

- [ ] **Step 4: Run test to verify it still fails for the intended reason**

Run: `npm run test:translations`
Expected: FAIL because the shared smoke-test runner is still missing.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/translation-services.test.ts
git commit -m "test: scaffold translation smoke test harness"
```

### Task 2: Extract Shared Provider Logic With Env-Aware Configuration

**Files:**
- Create: `D:\lovetingyuan\fanslate\utils\translationProviders.ts`
- Modify: `D:\lovetingyuan\fanslate\utils\translation.ts`
- Modify: `D:\lovetingyuan\fanslate\env.d.ts`

- [ ] **Step 1: Write the failing test for an env-backed provider**

```ts
it('deepl translates apple to 苹果 when DEEPL_API_KEY is set', async () => {
  const result = await runTranslationSmokeTest('deepl')
  expect(result).toBe('苹果')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:translations`
Expected: FAIL because DeepL and other providers still depend on extension-only storage access.

- [ ] **Step 3: Write minimal shared implementation**

```ts
export interface TranslationProviderRuntimeConfig {
  getDeepLApiKey: () => Promise<string | null>
  getOpenRouterApiKey: () => Promise<string | null>
  getOpenRouterModel: () => Promise<string>
  getGoogleApiKey: () => Promise<string>
  getMicrosoftToken: (signal?: AbortSignal) => Promise<string>
}

export const createTranslationProviders = (
  config: TranslationProviderRuntimeConfig,
): Record<TranslationServiceId, TranslatorFunction> => {
  // move provider request logic here
}
```

```ts
const extensionRuntimeConfig: TranslationProviderRuntimeConfig = {
  getDeepLApiKey: async () => {
    const settings = await browser.storage.local.get(['deeplApiKey'])
    return typeof settings.deeplApiKey === 'string' ? settings.deeplApiKey : null
  },
  getOpenRouterApiKey: async () => {
    const settings = await browser.storage.local.get(['openRouterApiKey'])
    return typeof settings.openRouterApiKey === 'string' ? settings.openRouterApiKey : null
  },
  getOpenRouterModel: async () => 'openrouter/free',
  getGoogleApiKey: async () => getApiKey(),
  getMicrosoftToken,
}
```

- [ ] **Step 4: Run test to verify the shared module is now callable**

Run: `npm run test:translations`
Expected: FAIL only because the Node-side smoke-test runtime has not been implemented yet.

- [ ] **Step 5: Commit**

```bash
git add utils/translationProviders.ts utils/translation.ts env.d.ts tests/translation-services.test.ts
git commit -m "refactor: extract shared translation providers"
```

### Task 3: Implement Node Smoke-Test Runtime And Full Provider Coverage

**Files:**
- Create: `D:\lovetingyuan\fanslate\tests\translationSmokeTestRuntime.ts`
- Modify: `D:\lovetingyuan\fanslate\tests\translation-services.test.ts`

- [ ] **Step 1: Write the failing tests for all providers**

```ts
for (const service of ['google', 'microsoft', 'tencent', 'deepl', 'openrouter'] as const) {
  it(`${service} translates apple to 苹果`, async () => {
    const result = await runTranslationSmokeTest(service)
    expect(result).toBe('苹果')
  }, 30_000)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:translations`
Expected: FAIL because `runTranslationSmokeTest` does not yet create a Node-compatible provider runtime or required environment checks.

- [ ] **Step 3: Write minimal smoke-test runtime**

```ts
export const runTranslationSmokeTest = async (
  service: TranslationServiceId,
): Promise<string> => {
  const providers = createTranslationProviders(createNodeTestRuntimeConfig())
  const translation = await providers[service]('apple', 'zh')
  return translation.trim()
}
```

```ts
const createNodeTestRuntimeConfig = (): TranslationProviderRuntimeConfig => ({
  getDeepLApiKey: async () => requireEnv('DEEPL_API_KEY'),
  getOpenRouterApiKey: async () => requireEnv('OPENROUTER_API_KEY'),
  getOpenRouterModel: async () => 'openrouter/free',
  getGoogleApiKey: async () => getApiKey(),
  getMicrosoftToken: async signal => fetchMicrosoftTokenForTests(signal),
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:translations`
Expected: PASS for providers with valid network access and correctly configured environment variables, each returning `苹果`.

- [ ] **Step 5: Commit**

```bash
git add tests/translationSmokeTestRuntime.ts tests/translation-services.test.ts
git commit -m "test: add live translation provider smoke tests"
```

### Task 4: Gate Zip Commands And Document Required Environment Variables

**Files:**
- Modify: `D:\lovetingyuan\fanslate\package.json`
- Modify: `D:\lovetingyuan\fanslate\README.md`
- Create: `D:\lovetingyuan\fanslate\.env.example`

- [ ] **Step 1: Write the failing behavioral test via script expectation**

```ts
expect(packageJson.scripts.zip).toContain('test:translations')
expect(packageJson.scripts['zip:firefox']).toContain('test:translations')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:translations`
Expected: FAIL because package scripts do not yet gate zip commands behind the smoke tests.

- [ ] **Step 3: Write minimal script and docs updates**

```json
{
  "scripts": {
    "zip": "npm run test:translations && wxt zip",
    "zip:firefox": "npm run test:translations && wxt zip -b firefox"
  }
}
```

```dotenv
DEEPL_API_KEY=
OPENROUTER_API_KEY=
```

- [ ] **Step 4: Run test and spot-check docs**

Run: `npm run test:translations`
Expected: PASS, and `README.md` documents the required environment variables and the pre-zip verification behavior.

- [ ] **Step 5: Commit**

```bash
git add package.json README.md .env.example
git commit -m "build: require translation smoke tests before zip"
```
