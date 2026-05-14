import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Next.js's `server-only` package throws when imported outside a server
      // build. Tests run in node so we stub it to a no-op. The prod build
      // sees the real package via normal resolution.
      "server-only": path.resolve(
        __dirname,
        "./src/lib/__mocks__/server-only.ts",
      ),
    },
  },
});
