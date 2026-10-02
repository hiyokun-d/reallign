import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // app/demo is a sealed playground: nothing outside may import from it...
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    ignores: ["app/demo/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@/app/demo", "@/app/demo/*", "**/demo/*"], message: "app/demo is sealed. Don't import from it." }] },
      ],
    },
  },
  // ...and it may only import npm packages and its own files.
  {
    files: ["app/demo/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@/*", "../*"], message: "app/demo is sealed. Only npm packages and ./ files." }] },
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
  ]),
]);

export default eslintConfig;
