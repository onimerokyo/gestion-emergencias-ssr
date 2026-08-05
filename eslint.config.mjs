import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([
    ".next/**",
    "dist/**",
    "github-pages-dist/**",
    "node_modules/**",
    "tsconfig.github.tsbuildinfo",
  ]),
]);
