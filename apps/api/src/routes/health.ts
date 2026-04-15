import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", {
    schema: {
      tags: ["health"],
      summary: "Liveness check",
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string" },
            service: { type: "string" },
          },
        },
      },
    },
  }, async () => ({ status: "ok", service: "bodybuilder-api" }));

  app.get("/health/ready", {
    schema: {
      tags: ["health"],
      summary: "Readiness check (verifica conexión a BD)",
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string" },
            database: { type: "string" },
          },
        },
      },
    },
  }, async (_req, reply) => {
    if (!process.env.DATABASE_URL) {
      return reply.status(503).send({ status: "not_ready", database: "missing_database_url" });
    }
    try {
      const { db } = await import("../db/index.js");
      await db.execute(sql`select 1`);
      return { status: "ready", database: "ok" };
    } catch (e) {
      app.log.error(e, "readiness check failed");
      return reply.status(503).send({ status: "not_ready", database: "error" });
    }
  });
};
