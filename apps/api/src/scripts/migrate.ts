/**
 * Script de migración programático usando drizzle-orm/migrator.
 * No depende de drizzle-kit (devDependency) — seguro en producción.
 */
import "dotenv/config";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dirname, "../../drizzle");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const client = postgres(connectionString, { max: 1 });
const db = drizzle(client);

console.log("Ejecutando migraciones...");
await migrate(db, { migrationsFolder });
console.log("Migraciones completadas.");
await client.end();
