import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Server code must not call the raw global fetch: user-influenced URLs have to go through
  // @/lib/ssrf-guard (safeFetch / pinnedProviderFetch). Web Ops release condition.
  {
    files: ["src/app/api/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/__tests__/**", // tests drive real/fake servers and stub fetch on purpose
      "src/lib/ssrf-guard.ts", // the guard itself: the only place that calls the network directly
      "src/lib/ssrf-guard.browser.ts", // browser build of the guard (client bundles; no server SSRF surface)
      "src/lib/hooks/**", // React client hooks: same-origin relative "/api/..." calls from the browser
      "src/lib/auth/session.ts", // client-side: GET relative /api/auth/config from the browser
      "src/lib/gen-params.ts", // client-side: POST relative /api/ai/models from the browser
      "src/lib/pipeline-runner.ts", // calls this app's own API on input.origin (request origin), never a user URL
      "src/lib/mock-ai.ts", // offline mock LLM fetch implementation: answers locally, never hits the network
      "src/lib/llm-server-default.ts", // wraps a fetch passed in for the fixed Gemini endpoint (constant URL)
    ],
    rules: {
      "no-restricted-globals": ["error", { name: "fetch", message: "Raw fetch is banned in server code: use safeFetch / pinnedProviderFetch from @/lib/ssrf-guard (or add a justified allowlist entry in eslint.config.mjs)." }],
      "no-restricted-syntax": [
        "error",
        { selector: "MemberExpression[object.name=/^(globalThis|window|global|self)$/][property.name='fetch']", message: "Raw fetch is banned in server code: use @/lib/ssrf-guard." },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Electron main process and build scripts are Node CommonJS/ESM entry points, not subject to Next app lint rules
    "electron/**",
    "scripts/**",
    "release/**",
  ]),
]);

export default eslintConfig;
