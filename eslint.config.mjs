import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "coverage/**",
    "apps/extension/.output/**",
    "apps/extension/.wxt/**",
    "apps/extension/dist/**",
    "outputs/**",
    "playwright-report/**",
    "test-results/**",
    "work/**",
    "next-env.d.ts",
  ]),
]);
