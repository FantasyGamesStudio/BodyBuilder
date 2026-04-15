import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Variables de entorno para los workers de test
    env: loadEnvFile(".env.test"),
    // Un único worker secuencial para que los tests de integración
    // no compitan por la BD compartida
    maxWorkers: 1,
    minWorkers: 1,
    // Aplica migraciones una sola vez antes de toda la suite
    globalSetup: ["src/__tests__/helpers/globalSetup.ts"],
    include: ["src/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/__tests__/**", "src/index.ts"],
      reporter: ["text", "html"],
    },
  },
});

function loadEnvFile(filePath: string): Record<string, string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    const content = fs.readFileSync(filePath, "utf-8");
    const result: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return result;
  } catch {
    return {};
  }
}
