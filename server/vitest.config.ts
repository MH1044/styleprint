import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@styleprint/shared": fileURLToPath(new URL("../shared/src/types.ts", import.meta.url)),
    },
  },
});
