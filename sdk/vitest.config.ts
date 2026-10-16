/**
 * Vitest configuration for @soroban-merkle-airdrop/sdk.
 *
 * Coverage is collected via @vitest/coverage-v8 (V8 native instrumentation).
 * Run `pnpm test:coverage` to generate an HTML report in sdk/coverage/.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run test files co-located with source under src/
    include: ["src/**/*.test.ts"],

    coverage: {
      // Use V8's built-in coverage instrumentation — no Babel/Istanbul transform needed.
      provider: "v8",

      // Source files to measure.  Exclude generated dist files and type-only modules.
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.d.ts",
        // types.ts is mostly interfaces/enums — still tracked so gaps are visible.
      ],

      // Reporters: text summary in the terminal + full HTML report in coverage/
      reporter: ["text", "html", "lcov"],

      // Output directory for the HTML and lcov artefacts.
      reportsDirectory: "./coverage",

      // Keep coverage artefacts for CI artifact upload.
      clean: true,
    },
  },
});
