import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Minimal vitest setup for pure-function unit tests (lib/). The full
// @testing-library/react + CI wiring is FE refactor plan item 2.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
});
