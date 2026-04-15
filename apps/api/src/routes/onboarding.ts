import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import {
  type ActivityLevel,
  type GoalMode,
  type Sex,
  calcTdee,
} from "../lib/tdee.js";

// ─── Schemas de validación compartidos ───────────────────────────────────────

const ActivityLevelEnum = z.enum([
  "sedentary",
  "lightly_active",
  "moderately_active",
  "very_active",
  "extra_active",
]);

const GoalModeEnum = z.enum([
  "volumen_limpio",
  "mantenimiento",
  "definicion",
  "recomposicion",
  "perdida_peso",
]);

const SexEnum = z.enum(["m", "f", "other"]);

const OnboardingBody = z.object({
  weightKg: z.number().positive().max(300),
  heightCm: z.number().int().min(100).max(250),
  ageYears: z.number().int().min(14).max(100),
  sex: SexEnum,
  activityLevel: ActivityLevelEnum,
  goalMode: GoalModeEnum,
  /** Pasos NEAT confirmados por el usuario (usa el sugerido si no se envía) */
  neatFloorSteps: z.number().int().min(1000).max(30000).optional(),
});

// ─── Schemas OpenAPI para Fastify/Swagger ────────────────────────────────────

const onboardingInputSchema = {
  type: "object",
  required: ["weightKg", "heightCm", "ageYears", "sex", "activityLevel", "goalMode"],
  properties: {
    weightKg: { type: "number", minimum: 30, maximum: 300 },
    heightCm: { type: "integer", minimum: 100, maximum: 250 },
    ageYears: { type: "integer", minimum: 14, maximum: 100 },
    sex: { type: "string", enum: ["m", "f", "other"] },
    activityLevel: {
      type: "string",
      enum: ["sedentary", "lightly_active", "moderately_active", "very_active", "extra_active"],
    },
    goalMode: {
      type: "string",
      enum: ["volumen_limpio", "mantenimiento", "definicion", "recomposicion", "perdida_peso"],
    },
    neatFloorSteps: { type: "integer", minimum: 1000, maximum: 30000 },
  },
} as const;

const suggestionResponseSchema = {
  type: "object",
  properties: {
    bmr: { type: "integer" },
    tdee: { type: "integer" },
    kcalTarget: { type: "integer" },
    proteinMinG: { type: "integer" },
    fatMinG: { type: "integer" },
    fatMaxG: { type: "integer" },
    carbsG: { type: "integer" },
    kcalGreenPct: { type: "integer" },
    neatSuggestedSteps: { type: "integer" },
    kcalRangeMin: { type: "integer" },
    kcalRangeMax: { type: "integer" },
  },
} as const;

// ─── Plugin ──────────────────────────────────────────────────────────────────

export const onboardingRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /v1/onboarding/suggestion
   *
   * Calcula y devuelve la sugerencia de kcal y macros SIN persistir nada.
   * Útil para mostrar la previsualización en la UI antes de confirmar.
   */
  app.get("/v1/onboarding/suggestion", {
    schema: {
      tags: ["onboarding"],
      summary: "Previsualizar cálculo de TDEE y macros (sin guardar)",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        required: ["weightKg", "heightCm", "ageYears", "sex", "activityLevel", "goalMode"],
        properties: {
          weightKg: { type: "number" },
          heightCm: { type: "integer" },
          ageYears: { type: "integer" },
          sex: { type: "string", enum: ["m", "f", "other"] },
          activityLevel: {
            type: "string",
            enum: ["sedentary", "lightly_active", "moderately_active", "very_active", "extra_active"],
          },
          goalMode: {
            type: "string",
            enum: ["volumen_limpio", "mantenimiento", "definicion", "recomposicion", "perdida_peso"],
          },
        },
      },
      response: { 200: suggestionResponseSchema },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const q = req.query as Record<string, string>;

    const parsed = OnboardingBody.safeParse({
      weightKg: Number(q.weightKg),
      heightCm: Number(q.heightCm),
      ageYears: Number(q.ageYears),
      sex: q.sex,
      activityLevel: q.activityLevel,
      goalMode: q.goalMode,
    });

    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_input", details: parsed.error.flatten() });
    }

    const result = calcTdee(parsed.data as Parameters<typeof calcTdee>[0]);
    const margin = Math.round(result.kcalTarget * result.kcalGreenPct / 100);

    return reply.send({
      ...result,
      kcalRangeMin: result.kcalTarget - margin,
      kcalRangeMax: result.kcalTarget + margin,
    });
  });

  /**
   * POST /v1/onboarding
   *
   * Confirma el onboarding: persiste los datos físicos, calcula el target set,
   * desactiva cualquier target anterior y marca el perfil como completado.
   */
  app.post("/v1/onboarding", {
    schema: {
      tags: ["onboarding"],
      summary: "Completar onboarding y guardar objetivos nutricionales",
      security: [{ bearerAuth: [] }],
      body: onboardingInputSchema,
      response: {
        201: {
          type: "object",
          properties: {
            onboardingId: { type: "string", format: "uuid" },
            targetSetId: { type: "string", format: "uuid" },
            suggestion: suggestionResponseSchema,
          },
        },
      },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const userId = req.user.sub;

    const body = OnboardingBody.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: "invalid_input", details: body.error.flatten() });
    }

    const {
      weightKg,
      heightCm,
      ageYears,
      sex,
      activityLevel,
      goalMode,
      neatFloorSteps,
    } = body.data;

    const result = calcTdee({
      weightKg,
      heightCm,
      ageYears,
      sex: sex as Sex,
      activityLevel: activityLevel as ActivityLevel,
      goalMode: goalMode as GoalMode,
    });

    const confirmedSteps = neatFloorSteps ?? result.neatSuggestedSteps;

    // Transacción: guardar onboarding + target set + desactivar anteriores
    const { onboardingId, targetSetId } = await db.transaction(async (tx) => {
      // 1. Registrar datos físicos
      const [onboarding] = await tx
        .insert(schema.userOnboardings)
        .values({
          userId,
          weightKg: String(weightKg),
          heightCm,
          ageYears,
          sex,
          activityLevel,
          goalMode,
          neatFloorSuggestedSteps: result.neatSuggestedSteps,
          neatFloorSteps: confirmedSteps,
        })
        .returning({ id: schema.userOnboardings.id });

      // 2. Desactivar targets anteriores
      await tx
        .update(schema.nutritionTargetSets)
        .set({ isActive: false })
        .where(eq(schema.nutritionTargetSets.userId, userId));

      // 3. Crear nuevo target set activo
      const [targetSet] = await tx
        .insert(schema.nutritionTargetSets)
        .values({
          userId,
          sourceOnboardingId: onboarding.id,
          kcalTarget: result.kcalTarget,
          kcalTdee: result.tdee,
          proteinMinG: result.proteinMinG,
          fatMinG: result.fatMinG,
          fatMaxG: result.fatMaxG,
          carbsG: result.carbsG,
          kcalGreenPct: result.kcalGreenPct,
          isActive: true,
        })
        .returning({ id: schema.nutritionTargetSets.id });

      // 4. Marcar perfil como onboarding completado
      await tx
        .update(schema.userProfiles)
        .set({ onboardingCompleted: true, updatedAt: new Date() })
        .where(eq(schema.userProfiles.userId, userId));

      return { onboardingId: onboarding.id, targetSetId: targetSet.id };
    });

    const margin = Math.round(result.kcalTarget * result.kcalGreenPct / 100);

    return reply.status(201).send({
      onboardingId,
      targetSetId,
      suggestion: {
        ...result,
        kcalRangeMin: result.kcalTarget - margin,
        kcalRangeMax: result.kcalTarget + margin,
      },
    });
  });

  /**
   * GET /v1/onboarding/active-target
   *
   * Devuelve el target set activo del usuario autenticado.
   */
  app.get("/v1/onboarding/active-target", {
    schema: {
      tags: ["onboarding"],
      summary: "Obtener el objetivo nutricional activo del usuario",
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            kcalTarget: { type: "integer" },
            kcalTdee: { type: "integer" },
            proteinMinG: { type: "integer" },
            fatMinG: { type: "integer" },
            fatMaxG: { type: "integer" },
            carbsG: { type: "integer" },
            kcalGreenPct: { type: "integer" },
            kcalRangeMin: { type: "integer" },
            kcalRangeMax: { type: "integer" },
            effectiveFrom: { type: "string", format: "date-time" },
            goalMode: { type: "string" },
            activityLevel: { type: "string" },
            weightKg: { type: "number" },
            heightCm: { type: ["integer", "null"] },
            ageYears: { type: ["integer", "null"] },
            sex: { type: ["string", "null"] },
            neatFloorSteps: { type: ["integer", "null"] },
          },
        },
        404: { $ref: "ErrorResponse#" },
      },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const userId = req.user.sub;

    const target = await db.query.nutritionTargetSets.findFirst({
      where: (t, { and, eq }) => and(eq(t.userId, userId), eq(t.isActive, true)),
      with: { sourceOnboarding: true },
    });

    if (!target) {
      return reply.status(404).send({ error: "no_active_target" });
    }

    const margin = Math.round(target.kcalTarget * target.kcalGreenPct / 100);

    return reply.send({
      id: target.id,
      kcalTarget: target.kcalTarget,
      kcalTdee: target.kcalTdee,
      proteinMinG: target.proteinMinG,
      fatMinG: target.fatMinG,
      fatMaxG: target.fatMaxG,
      carbsG: target.carbsG,
      kcalGreenPct: target.kcalGreenPct,
      kcalRangeMin: target.kcalTarget - margin,
      kcalRangeMax: target.kcalTarget + margin,
      effectiveFrom: target.effectiveFrom,
      goalMode: target.sourceOnboarding?.goalMode,
      activityLevel: target.sourceOnboarding?.activityLevel,
      weightKg: target.sourceOnboarding ? Number(target.sourceOnboarding.weightKg) : null,
      heightCm: target.sourceOnboarding?.heightCm ?? null,
      ageYears: target.sourceOnboarding?.ageYears ?? null,
      sex: target.sourceOnboarding?.sex ?? null,
      neatFloorSteps: target.sourceOnboarding?.neatFloorSteps,
    });
  });
};
