import "dotenv/config";
import { buildApp } from "./app.js";
import { env } from "./lib/env.js";

const app = await buildApp();

try {
  // Railway (y otras plataformas) inyectan PORT en el entorno; tiene prioridad sobre API_PORT
const port = Number(process.env.PORT ?? env.API_PORT);
await app.listen({ host: env.API_HOST, port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
