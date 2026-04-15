import "dotenv/config";
import { buildApp } from "./app.js";
import { env } from "./lib/env.js";

const app = await buildApp();

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
