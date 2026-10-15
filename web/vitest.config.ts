import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Point the SDK at a lightweight stub so tests don't need stellar-sdk
      // The stub's symbols are fully replaced by vi.mock() in each test file.
      "@soroban-merkle-airdrop/sdk": path.resolve(
        __dirname,
        "./src/test/sdk-stub.ts"
      ),
    },
  },
});
