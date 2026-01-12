import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "out/**", "build/**", ".firebase/**", "next-env.d.ts"],
  },
  // Relax rules for test files
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "warn",
    },
  },
  // Relax rules for stories
  {
    files: ["**/*.stories.tsx", "**/stories/**"],
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "react/no-unescaped-entities": "off",
    },
  },
  // Global rule adjustments
  {
    rules: {
      // Allow sync scripts (needed for Telegram WebApp SDK)
      "@next/next/no-sync-scripts": "off",
      // Warn instead of error for unused vars
      "@typescript-eslint/no-unused-vars": "warn",
      // Allow require() in specific cases (dynamic imports)
      "@typescript-eslint/no-require-imports": "warn",
      // Warn for explicit any instead of error
      "@typescript-eslint/no-explicit-any": "warn",
      // Warn for prefer-const
      "prefer-const": "warn",
      // Warn for unescaped entities
      "react/no-unescaped-entities": "warn",
      // Warn for hooks rules (some existing patterns need refactoring)
      "react-hooks/rules-of-hooks": "warn",
      // Warn for exhaustive deps
      "react-hooks/exhaustive-deps": "warn",
      // Warn for img element
      "@next/next/no-img-element": "warn",
      // Warn for anonymous default export
      "import/no-anonymous-default-export": "warn",
    },
  },
];

export default eslintConfig;
