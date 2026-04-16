import { and, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db, schema } from "../db/index.js";

const WorkoutBody = z.object({
  workoutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kcalBurned: z.number().int().min(0).max(5000),
  notes: z.string().max(200).optional(),
  status: z.enum(["done", "planned"]).default("done"),
  plannedAt: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

const WorkoutPatchBody = z.object({
  kcalBurned: z.number().int().min(0).max(5000).optional(),
  notes: z.string().max(200).optional(),
  status: z.enum(["done", "planned"]).optional(),
  plannedAt: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
});

function serializeWorkout(entry: typeof schema.workoutLogs.$inferSelect) {
  return {
    id: entry.id,
    workoutDate: entry.workoutDate,
    kcalBurned: entry.kcalBurned,
    notes: entry.notes,
    status: entry.status,
    plannedAt: entry.plannedAt,
    createdAt: entry.createdAt.toISOString(),
  };
}

export const workoutsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /v1/workouts
   * Registra o planifica un entrenamiento para una fecha.
   * status=done (default): kcal se suman al EAT del día
   * status=planned: el asesor lo usa para preparar consejos de timing
   */
  app.post("/v1/workouts", {
    schema: {
      tags: ["workouts"],
      summary: "Registrar o planificar un entrenamiento",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["workoutDate", "kcalBurned"],
        properties: {
          workoutDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          kcalBurned: { type: "integer", minimum: 0, maximum: 5000 },
          notes: { type: "string", maxLength: 200 },
          status: { type: "string", enum: ["done", "planned"] },
          plannedAt: { type: "string" },
        },
      },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const userId = req.user.sub;
    const body = WorkoutBody.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: "invalid_input", details: body.error.flatten() });
    }

    const [entry] = await db
      .insert(schema.workoutLogs)
      .values({
        userId,
        workoutDate: body.data.workoutDate,
        kcalBurned: body.data.kcalBurned,
        notes: body.data.notes ?? null,
        status: body.data.status,
        plannedAt: body.data.plannedAt ?? null,
      })
      .returning();

    return reply.status(201).send(serializeWorkout(entry));
  });

  /**
   * PATCH /v1/workouts/:id
   * Actualiza un entrenamiento (ej. marcar como done con kcal reales).
   */
  app.patch("/v1/workouts/:id", {
    schema: {
      tags: ["workouts"],
      summary: "Actualizar un entrenamiento",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const userId = req.user.sub;
    const { id } = req.params as { id: string };
    const body = WorkoutPatchBody.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: "invalid_input", details: body.error.flatten() });
    }

    const updateData: Partial<typeof schema.workoutLogs.$inferInsert> = {};
    if (body.data.kcalBurned !== undefined) updateData.kcalBurned = body.data.kcalBurned;
    if (body.data.notes !== undefined) updateData.notes = body.data.notes;
    if (body.data.status !== undefined) updateData.status = body.data.status;
    if (body.data.plannedAt !== undefined) updateData.plannedAt = body.data.plannedAt;

    const [updated] = await db
      .update(schema.workoutLogs)
      .set(updateData)
      .where(and(eq(schema.workoutLogs.id, id), eq(schema.workoutLogs.userId, userId)))
      .returning();

    if (!updated) return reply.status(404).send({ error: "not_found" });
    return reply.send(serializeWorkout(updated));
  });

  /**
   * DELETE /v1/workouts/:id
   */
  app.delete("/v1/workouts/:id", {
    schema: {
      tags: ["workouts"],
      summary: "Eliminar un entrenamiento registrado",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
      response: { 204: { type: "null" } },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const userId = req.user.sub;
    const { id } = req.params as { id: string };

    const deleted = await db
      .delete(schema.workoutLogs)
      .where(and(eq(schema.workoutLogs.id, id), eq(schema.workoutLogs.userId, userId)))
      .returning({ id: schema.workoutLogs.id });

    if (deleted.length === 0) return reply.status(404).send({ error: "not_found" });
    return reply.status(204).send();
  });
};
