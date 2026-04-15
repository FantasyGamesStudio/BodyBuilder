import { and, eq, gte, lte } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { computeDayProgress, computeMacros } from "../lib/nutrition.js";

const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack", "other"] as const;
type MealSlot = typeof MEAL_SLOTS[number];

const LogMealBody = z.object({
  foodId: z.string().uuid(),
  nutritionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD"),
  mealSlot: z.enum(MEAL_SLOTS),
  quantityG: z.number().positive().max(5000),
});

const PatchMealBody = z.object({
  quantityG: z.number().positive().max(5000).optional(),
  mealSlot: z.enum(MEAL_SLOTS).optional(),
});

// ─── Helpers de serialización ─────────────────────────────────────────────────

function serializeEntry(entry: {
  id: string;
  foodId: string | null;
  foodName?: string | null;
  nutritionDate: string;
  mealSlot: string;
  quantityG: string | number;
  kcal: number;
  proteinG: string | number;
  fatG: string | number;
  carbsG: string | number;
  loggedAt: Date;
  food?: { id: string; name: string; brand: string | null } | null;
}) {
  // Para entradas del asesor IA: food es null pero tenemos foodName
  const resolvedFood = entry.food
    ? entry.food
    : entry.foodName
      ? { id: null, name: entry.foodName, brand: null }
      : null;

  return {
    id: entry.id,
    foodId: entry.foodId,
    food: resolvedFood,
    nutritionDate: entry.nutritionDate,
    mealSlot: entry.mealSlot,
    quantityG: Number(entry.quantityG),
    kcal: entry.kcal,
    proteinG: Number(entry.proteinG),
    fatG: Number(entry.fatG),
    carbsG: Number(entry.carbsG),
    loggedAt: entry.loggedAt,
  };
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

export const mealsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /v1/meals
   * Registra una entrada de comida para el usuario autenticado.
   */
  app.post("/v1/meals", {
    schema: {
      tags: ["meals"],
      summary: "Registrar una comida",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["foodId", "nutritionDate", "mealSlot", "quantityG"],
        properties: {
          foodId: { type: "string", format: "uuid" },
          nutritionDate: { type: "string" },
          mealSlot: { type: "string", enum: [...MEAL_SLOTS] },
          quantityG: { type: "number", minimum: 0.1 },
        },
      },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const body = LogMealBody.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: "invalid_input", details: body.error.flatten() });
    }

    const { foodId, nutritionDate, mealSlot, quantityG } = body.data;
    const userId = req.user.sub;

    const food = await db.query.foods.findFirst({
      where: eq(schema.foods.id, foodId),
    });
    if (!food) return reply.status(404).send({ error: "food_not_found" });

    const macros = computeMacros(
      {
        kcalPer100g: Number(food.kcalPer100g),
        proteinPer100g: Number(food.proteinPer100g),
        fatPer100g: Number(food.fatPer100g),
        carbsPer100g: Number(food.carbsPer100g),
      },
      quantityG,
    );

    const [entry] = await db
      .insert(schema.mealLogEntries)
      .values({
        userId,
        foodId,
        nutritionDate,
        mealSlot,
        quantityG: String(quantityG),
        kcal: macros.kcal,
        proteinG: String(macros.proteinG),
        fatG: String(macros.fatG),
        carbsG: String(macros.carbsG),
      })
      .returning();

    return reply.status(201).send(serializeEntry({ ...entry, food: { id: food.id, name: food.name, brand: food.brand } }));
  });

  /**
   * PATCH /v1/meals/:id
   * Actualiza la cantidad o el slot de una entrada.
   * Recalcula los macros si cambia la cantidad.
   */
  app.patch("/v1/meals/:id", {
    schema: {
      tags: ["meals"],
      summary: "Actualizar cantidad o slot de una comida registrada",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
      body: {
        type: "object",
        properties: {
          quantityG: { type: "number", minimum: 0.1 },
          mealSlot: { type: "string", enum: [...MEAL_SLOTS] },
        },
      },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.user.sub;

    const body = PatchMealBody.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: "invalid_input", details: body.error.flatten() });
    }

    const existing = await db.query.mealLogEntries.findFirst({
      where: and(eq(schema.mealLogEntries.id, id), eq(schema.mealLogEntries.userId, userId)),
      with: { food: true },
    });
    if (!existing) return reply.status(404).send({ error: "entry_not_found" });
    if (!existing.food) return reply.status(422).send({ error: "entry_has_no_food" });

    const { quantityG, mealSlot } = body.data;
    const updates: Record<string, unknown> = {};

    if (mealSlot) updates.mealSlot = mealSlot;

    if (quantityG !== undefined) {
      const macros = computeMacros(
        {
          kcalPer100g: Number(existing.food.kcalPer100g),
          proteinPer100g: Number(existing.food.proteinPer100g),
          fatPer100g: Number(existing.food.fatPer100g),
          carbsPer100g: Number(existing.food.carbsPer100g),
        },
        quantityG,
      );
      updates.quantityG = String(quantityG);
      updates.kcal = macros.kcal;
      updates.proteinG = String(macros.proteinG);
      updates.fatG = String(macros.fatG);
      updates.carbsG = String(macros.carbsG);
    }

    const [updated] = await db
      .update(schema.mealLogEntries)
      .set(updates)
      .where(and(eq(schema.mealLogEntries.id, id), eq(schema.mealLogEntries.userId, userId)))
      .returning();

    return reply.send(serializeEntry({
      ...updated,
      food: { id: existing.food.id, name: existing.food.name, brand: existing.food.brand },
    }));
  });

  /**
   * DELETE /v1/meals/:id
   * Elimina una entrada de comida.
   */
  app.delete("/v1/meals/:id", {
    schema: {
      tags: ["meals"],
      summary: "Eliminar una comida registrada",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
      response: { 200: { type: "object", properties: { ok: { type: "boolean" } } } },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.user.sub;

    const deleted = await db
      .delete(schema.mealLogEntries)
      .where(and(eq(schema.mealLogEntries.id, id), eq(schema.mealLogEntries.userId, userId)))
      .returning({ id: schema.mealLogEntries.id });

    if (!deleted.length) return reply.status(404).send({ error: "entry_not_found" });
    return reply.send({ ok: true });
  });

  /**
   * GET /v1/meals/day/:date
   *
   * Devuelve todas las entradas de un día junto con:
   * - entradas agrupadas por slot
   * - totales del día (kcal, proteína, grasa, carbos)
   * - progreso contra el target activo con estado verde/amarillo/rojo
   */
  app.get("/v1/meals/day/:date", {
    schema: {
      tags: ["meals"],
      summary: "Resumen nutricional de un día",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["date"],
        properties: { date: { type: "string" } },
      },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const { date } = req.params as { date: string };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.status(400).send({ error: "invalid_date_format" });
    }

    const userId = req.user.sub;

    // Entradas de comida y entrenamientos del día (en paralelo)
    const [entries, workouts] = await Promise.all([
      db.query.mealLogEntries.findMany({
        where: and(
          eq(schema.mealLogEntries.userId, userId),
          eq(schema.mealLogEntries.nutritionDate, date),
        ),
        with: { food: { columns: { id: true, name: true, brand: true } } },
        orderBy: (e, { asc }) => [asc(e.loggedAt)],
        columns: {
          id: true, foodId: true, foodName: true, nutritionDate: true,
          mealSlot: true, quantityG: true, kcal: true, proteinG: true,
          fatG: true, carbsG: true, loggedAt: true,
        },
      }),
      db.query.workoutLogs.findMany({
        where: and(
          eq(schema.workoutLogs.userId, userId),
          eq(schema.workoutLogs.workoutDate, date),
        ),
        orderBy: (w, { asc }) => [asc(w.createdAt)],
      }),
    ]);

    const serialized = entries.map(serializeEntry);
    const serializedWorkouts = workouts.map((w) => ({
      id: w.id,
      workoutDate: w.workoutDate,
      kcalBurned: w.kcalBurned,
      notes: w.notes,
      createdAt: w.createdAt,
    }));
    const eatKcal = serializedWorkouts.reduce((sum, w) => sum + w.kcalBurned, 0);

    // Agrupar por slot
    const bySlot = MEAL_SLOTS.reduce<Record<MealSlot, typeof serialized>>(
      (acc, slot) => ({ ...acc, [slot]: [] }),
      {} as Record<MealSlot, typeof serialized>,
    );
    for (const e of serialized) {
      const slot = e.mealSlot as MealSlot;
      bySlot[slot]?.push(e);
    }

    // Progreso contra target activo — el EAT se suma al target del día
    const target = await db.query.nutritionTargetSets.findFirst({
      where: and(
        eq(schema.nutritionTargetSets.userId, userId),
        eq(schema.nutritionTargetSets.isActive, true),
      ),
    });

    const progress = target
      ? computeDayProgress(
          serialized.map((e) => ({
            kcal: e.kcal,
            proteinG: e.proteinG,
            fatG: e.fatG,
            carbsG: e.carbsG,
          })),
          {
            kcalTarget: target.kcalTarget + eatKcal,
            proteinMinG: target.proteinMinG,
            fatMinG: target.fatMinG,
            fatMaxG: target.fatMaxG,
            carbsG: target.carbsG,
            kcalGreenPct: target.kcalGreenPct,
          },
        )
      : null;

    return reply.send({
      date,
      entries: serialized,
      bySlot,
      workouts: serializedWorkouts,
      eatKcal,
      progress,
    });
  });

  /**
   * GET /v1/meals/week/:weekStart
   *
   * Devuelve el resumen nutricional de una semana completa (lunes a domingo).
   * weekStart debe ser la fecha del lunes en formato YYYY-MM-DD.
   */
  app.get("/v1/meals/week/:weekStart", {
    schema: {
      tags: ["meals"],
      summary: "Resumen nutricional de una semana (lunes a domingo)",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["weekStart"],
        properties: { weekStart: { type: "string" } },
      },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const { weekStart } = req.params as { weekStart: string };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return reply.status(400).send({ error: "invalid_date_format" });
    }

    const startDate = new Date(weekStart + "T12:00:00");
    if (startDate.getDay() !== 1) {
      return reply.status(400).send({ error: "week_start_must_be_monday" });
    }

    // Genera los 7 días de la semana (lun → dom)
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart + "T12:00:00");
      d.setDate(d.getDate() + i);
      dates.push(d.toLocaleDateString("sv-SE"));
    }
    const weekEnd = dates[6];

    const userId = req.user.sub;

    const [allEntries, allWorkouts, target] = await Promise.all([
      db.query.mealLogEntries.findMany({
        where: and(
          eq(schema.mealLogEntries.userId, userId),
          gte(schema.mealLogEntries.nutritionDate, weekStart),
          lte(schema.mealLogEntries.nutritionDate, weekEnd),
        ),
        columns: {
          id: true, foodId: true, foodName: true, nutritionDate: true,
          mealSlot: true, quantityG: true, kcal: true, proteinG: true,
          fatG: true, carbsG: true, loggedAt: true,
        },
        with: { food: { columns: { id: true, name: true, brand: true } } },
      }),
      db.query.workoutLogs.findMany({
        where: and(
          eq(schema.workoutLogs.userId, userId),
          gte(schema.workoutLogs.workoutDate, weekStart),
          lte(schema.workoutLogs.workoutDate, weekEnd),
        ),
      }),
      db.query.nutritionTargetSets.findFirst({
        where: and(
          eq(schema.nutritionTargetSets.userId, userId),
          eq(schema.nutritionTargetSets.isActive, true),
        ),
      }),
    ]);

    // Agrupar por fecha
    const entriesByDate = new Map<string, typeof allEntries>(dates.map((d) => [d, []]));
    const workoutsByDate = new Map<string, typeof allWorkouts>(dates.map((d) => [d, []]));

    for (const e of allEntries) entriesByDate.get(e.nutritionDate)?.push(e);
    for (const w of allWorkouts) workoutsByDate.get(w.workoutDate)?.push(w);

    // Resumen por día
    const days = dates.map((date) => {
      const dayEntries = (entriesByDate.get(date) ?? []).map(serializeEntry);
      const dayWorkouts = workoutsByDate.get(date) ?? [];
      const eatKcal = dayWorkouts.reduce((s, w) => s + w.kcalBurned, 0);
      const hasData = dayEntries.length > 0 || dayWorkouts.length > 0;

      const progress = target
        ? computeDayProgress(
            dayEntries.map((e) => ({
              kcal: e.kcal,
              proteinG: e.proteinG,
              fatG: e.fatG,
              carbsG: e.carbsG,
            })),
            {
              kcalTarget: target.kcalTarget + eatKcal,
              proteinMinG: target.proteinMinG,
              fatMinG: target.fatMinG,
              fatMaxG: target.fatMaxG,
              carbsG: target.carbsG,
              kcalGreenPct: target.kcalGreenPct,
            },
          )
        : null;

      return { date, hasData, eatKcal, kcalTarget: target ? target.kcalTarget + eatKcal : 0, progress };
    });

    // Totales de la semana
    const weekTotals = {
      kcal: days.reduce((s, d) => s + (d.progress?.totals.kcal ?? 0), 0),
      proteinG: days.reduce((s, d) => s + (d.progress?.totals.proteinG ?? 0), 0),
      fatG: days.reduce((s, d) => s + (d.progress?.totals.fatG ?? 0), 0),
      carbsG: days.reduce((s, d) => s + (d.progress?.totals.carbsG ?? 0), 0),
    };

    return reply.send({
      weekStart,
      weekEnd,
      days,
      weekTotals,
      target: target
        ? {
            kcalTarget: target.kcalTarget,
            proteinMinG: target.proteinMinG,
            fatMinG: target.fatMinG,
            fatMaxG: target.fatMaxG,
            carbsG: target.carbsG,
          }
        : null,
    });
  });
};
