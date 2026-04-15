import { and, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db, schema } from "../db/index.js";

const WorkoutBody = z.object({
  workoutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kcalBurned: z.number().int().min(1).max(5000),
  notes: z.string().max(200).optional(),
});

export const workoutsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /v1/workouts
   * Registra un entrenamiento para una fecha. Las kcal quemadas se añaden
   * al target efectivo del día en el dashboard (EAT).
   */
  app.post("/v1/workouts", {
    schema: {
      tags: ["workouts"],
      summary: "Registrar un entrenamiento del día",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["workoutDate", "kcalBurned"],
        properties: {
          workoutDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          kcalBurned: { type: "integer", minimum: 1, maximum: 5000 },
          notes: { type: "string", maxLength: 200 },
        },
      },
      response: {
        201: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            workoutDate: { type: "string" },
            kcalBurned: { type: "integer" },
            notes: { type: "string", nullable: true },
            createdAt: { type: "string", format: "date-time" },
          },
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
      })
      .returning();

    return reply.status(201).send({
      id: entry.id,
      workoutDate: entry.workoutDate,
      kcalBurned: entry.kcalBurned,
      notes: entry.notes,
      createdAt: entry.createdAt,
    });
  });

  /**
   * DELETE /v1/workouts/:id
   * Elimina un entrenamiento registrado (solo el propietario).
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

    if (deleted.length === 0) {
      return reply.status(404).send({ error: "not_found" });
    }

    return reply.status(204).send();
  });
};
