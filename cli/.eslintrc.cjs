// @ts-check
"use strict";

/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    project: "./tsconfig.json",
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
  ],
  rules: {
    // Enforce consistent use of type imports
    "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
    // Disallow use of `any` — prefer explicit types
    "@typescript-eslint/no-explicit-any": "error",
    // Require return types on public functions
    "@typescript-eslint/explicit-function-return-type": ["warn", { allowExpressions: true }],
    // Disallow unused variables (use _ prefix to intentionally ignore)
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    // Prefer nullish coalescing over ||
    "@typescript-eslint/prefer-nullish-coalescing": "warn",
    // Prefer optional chaining over &&
    "@typescript-eslint/prefer-optional-chain": "warn",
  },
  env: {
    node: true,
    es2022: true,
  },
  ignorePatterns: ["dist/", "node_modules/"],
};
