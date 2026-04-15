/**
 * Utilidades de BD para los tests de integración.
 *
 * Usa una conexión dedicada a `bodybuilder_test` (cargada desde .env.test).
 * `resetDb()` trunca todas las tablas de dominio en cascada, dejando
 * el esquema intacto para el siguiente test.
 */

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import * as schema from "../../db/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../../drizzle");

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getTestDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL not set — load .env.test before running tests");
    _client = postgres(url, { max: 5 });
    _db = drizzle(_client, { schema });
  }
  return _db;
}

/** Aplica todas las migraciones pendientes sobre la BD de test. */
export async function runMigrations() {
  const db = getTestDb();
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

/**
 * Borra todos los datos de las tablas de dominio (TRUNCATE … CASCADE).
 * Las tablas del sistema de migraciones de Drizzle NO se tocan.
 */
export async function resetDb() {
  const db = getTestDb();
  await db.execute(sql`
    TRUNCATE TABLE
      meal_log_entries,
      foods,
      nutrition_target_sets,
      user_onboardings,
      refresh_tokens,
      user_profiles,
      users
    RESTART IDENTITY CASCADE
  `);
}

/** Cierra la conexión (llamar en afterAll global si es necesario). */
export async function closeTestDb() {
  if (_client) {
    await _client.end();
    _client = null;
    _db = null;
  }
}
