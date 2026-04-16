import { and, asc, between, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { db, schema } from "../db/index.js";

export const weightRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /v1/weight
   * Registra (o actualiza) el peso del día.
   * Upsert: si ya existe un registro para esa fecha, lo sobreescribe.
   */
  app.post("/v1/weight", {
    schema: {
      tags: ["weight"],
      summary: "Registrar peso del día",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["logDate", "weightKg"],
        properties: {
          logDate: { type: "string", description: "Fecha YYYY-MM-DD" },
          weightKg: { type: "number", minimum: 20, maximum: 500 },
          notes: { type: "string", maxLength: 500 },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            id: { type: "string" },
            logDate: { type: "string" },
            weightKg: { type: "number" },
            notes: { type: ["string", "null"] },
            createdAt: { type: "string" },
          },
        },
      },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const userId = req.user.sub;
    const { logDate, weightKg, notes } = req.body as {
      logDate: string;
      weightKg: number;
      notes?: string;
    };

    // Upsert: si ya existe entrada para ese día, actualizamos
    const existing = await db.query.weightLogs.findFirst({
      where: and(
        eq(schema.weightLogs.userId, userId),
        eq(schema.weightLogs.logDate, logDate),
      ),
    });

    if (existing) {
      const [updated] = await db
        .update(schema.weightLogs)
        .set({ weightKg: String(weightKg), notes: notes ?? null })
        .where(eq(schema.weightLogs.id, existing.id))
        .returning();
      return reply.send({
        id: updated.id,
        logDate: updated.logDate,
        weightKg: Number(updated.weightKg),
        notes: updated.notes,
        createdAt: updated.createdAt.toISOString(),
      });
    }

    const [created] = await db
      .insert(schema.weightLogs)
      .values({
        userId,
        logDate,
        weightKg: String(weightKg),
        notes: notes ?? null,
      })
      .returning();

    return reply.status(201).send({
      id: created.id,
      logDate: created.logDate,
      weightKg: Number(created.weightKg),
      notes: created.notes,
      createdAt: created.createdAt.toISOString(),
    });
  });

  /**
   * GET /v1/weight?from=YYYY-MM-DD&to=YYYY-MM-DD
   * Devuelve los registros de peso en un rango de fechas (máx. 90 días).
   */
  app.get("/v1/weight", {
    schema: {
      tags: ["weight"],
      summary: "Historial de peso en un rango",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        required: ["from", "to"],
        properties: {
          from: { type: "string" },
          to: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            entries: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  logDate: { type: "string" },
                  weightKg: { type: "number" },
                  notes: { type: ["string", "null"] },
                },
              },
            },
          },
        },
      },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const userId = req.user.sub;
    const { from, to } = req.query as { from: string; to: string };

    const rows = await db.query.weightLogs.findMany({
      where: and(
        eq(schema.weightLogs.userId, userId),
        between(schema.weightLogs.logDate, from, to),
      ),
      orderBy: [asc(schema.weightLogs.logDate)],
      limit: 90,
    });

    return reply.send({
      entries: rows.map((r) => ({
        id: r.id,
        logDate: r.logDate,
        weightKg: Number(r.weightKg),
        notes: r.notes,
      })),
    });
  });

  /**
   * DELETE /v1/weight/:id
   * Elimina un registro de peso.
   */
  app.delete("/v1/weight/:id", {
    schema: {
      tags: ["weight"],
      summary: "Eliminar registro de peso",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
      response: { 200: { type: "object", properties: { ok: { type: "boolean" } } } },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const userId = req.user.sub;
    const { id } = req.params as { id: string };

    const deleted = await db
      .delete(schema.weightLogs)
      .where(and(eq(schema.weightLogs.id, id), eq(schema.weightLogs.userId, userId)))
      .returning({ id: schema.weightLogs.id });

    if (!deleted.length) return reply.status(404).send({ error: "not_found" });
    return reply.send({ ok: true });
  });
};
