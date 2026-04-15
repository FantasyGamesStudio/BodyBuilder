/**
 * Ejecutado UNA vez antes de toda la suite de tests.
 * Carga .env.test y aplica migraciones sobre la BD de test.
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function setup() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  config({ path: path.resolve(__dirname, "../../../.env.test") });

  const { runMigrations } = await import("./db.js");
  await runMigrations();
}

export async function teardown() {
  const { closeTestDb } = await import("./db.js");
  await closeTestDb();
}
