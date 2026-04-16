/**
 * Rutas H2: gestión de medios, estados de comida, correcciones, re-procesamiento IA.
 *
 * Flujo:
 * 1. POST /v1/meals/draft → crea borrador
 * 2. POST /v1/meals/:id/media/upload-url → obtiene URL firmada para subir foto/audio
 * 3. POST /v1/meals/:id/submit-for-ai → envía a cola de IA
 * 4. PATCH /v1/meals/:id/confirm → confirma la estimación IA (o corrige manualmente)
 * 5. POST /v1/meals/:id/correction → registra corrección del usuario
 * 6. POST /v1/meals/:id/reprocess → re-procesa con nueva explicación
 */

import { and, eq, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { generatePresignedUploadUrl, generateObjectKey, mimeToExt } from "../lib/storage.js";
import { enqueueNutritionEstimate } from "../lib/queue.js";
import { computeMacros } from "../lib/nutrition.js";

const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack", "other"] as const;

const DraftMealBody = z.object({
  nutritionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD"),
  mealSlot: z.enum(MEAL_SLOTS),
  userNote: z.string().max(500).optional(),
});

const SubmitForAiBody = z.object({
  hasAudio: z.boolean().default(false),
  hasImages: z.boolean().default(false),
});

const ConfirmMealBody = z.object({
  /** Si el usuario acepta la estimación IA tal cual */
  acceptAiEstimate: z.boolean().optional(),
  /** Si el usuario corrige manualmente — min(0) para permitir agua/café negro */
  quantityG: z.number().min(0).max(5000).optional(),
  kcal: z.number().min(0).optional(),
  proteinG: z.number().min(0).optional(),
  fatG: z.number().min(0).optional(),
  carbsG: z.number().min(0).optional(),
});

const CorrectionBody = z.object({
  userExplanationText: z.string().max(1000).optional(),
  quantityG: z.number().min(0).max(5000).optional(),
  kcal: z.number().min(0).optional(),
  proteinG: z.number().min(0).optional(),
  fatG: z.number().min(0).optional(),
  carbsG: z.number().min(0).optional(),
});

const ReprocessBody = z.object({
  userExplanationText: z.string().max(1000).optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

type AiEstimate = {
  foodName?: string;
  kcal?: number;
  proteinG?: number;
  fatG?: number;
  carbsG?: number;
  reasoning?: string;
} | null;

function serializeEntry(entry: typeof schema.mealLogEntries.$inferSelect & {
  food?: { id: string; name: string; brand: string | null } | null;
  media?: Array<{ id: string; type: string; objectKey: string; mime: string }> | null;
  corrections?: Array<{ id: string; userExplanationText: string | null; createdAt: Date }> | null;
  aiInteractions?: Array<{ outputParsed: unknown; createdAt: Date }> | null;
}) {
  // Extraer estimación IA del interaction más reciente de tipo response
  let aiEstimate: AiEstimate = null;
  if (entry.aiInteractions && entry.aiInteractions.length > 0) {
    const latest = entry.aiInteractions[entry.aiInteractions.length - 1];
    const parsed = latest.outputParsed as Record<string, unknown> | null;
    if (parsed) {
      aiEstimate = {
        foodName: parsed.foodName as string | undefined,
        kcal: parsed.kcal as number | undefined,
        proteinG: parsed.proteinG as number | undefined,
        fatG: parsed.fatG as number | undefined,
        carbsG: parsed.carbsG as number | undefined,
        reasoning: parsed.reasoning as string | undefined,
      };
    }
  }

  return {
    id: entry.id,
    foodId: entry.foodId,
    foodName: entry.foodName,
    nutritionDate: entry.nutritionDate,
    mealSlot: entry.mealSlot,
    quantityG: Number(entry.quantityG),
    kcal: entry.kcal,
    proteinG: Number(entry.proteinG),
    fatG: Number(entry.fatG),
    carbsG: Number(entry.carbsG),
    status: entry.status,
    userNote: entry.userNote,
    loggedAt: entry.loggedAt,
    food: entry.food ?? null,
    media: (entry.media ?? []).map((m) => ({ id: m.id, type: m.type, objectKey: m.objectKey, mime: m.mime })),
    corrections: (entry.corrections ?? []).map((c) => ({
      id: c.id,
      userExplanationText: c.userExplanationText,
      createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
    })),
    aiEstimate,
  };
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export const h2MealsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /v1/meals/draft
   * Crea una entrada de comida en estado "draft".
   */
  app.post("/v1/meals/draft", {
    schema: {
      tags: ["meals-h2"],
      summary: "Crear borrador de comida",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["nutritionDate", "mealSlot"],
        properties: {
          nutritionDate: { type: "string" },
          mealSlot: { type: "string", enum: [...MEAL_SLOTS] },
          userNote: { type: "string" },
        },
      },
      response: {
        201: {
          type: "object",
          properties: {
            id: { type: "string" },
            status: { type: "string" },
            nutritionDate: { type: "string" },
            mealSlot: { type: "string" },
          },
        },
      },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const userId = req.user.sub;
    const body = DraftMealBody.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: "invalid_input", details: body.error.flatten() });
    }

    const [entry] = await db.insert(schema.mealLogEntries).values({
      userId,
      nutritionDate: body.data.nutritionDate,
      mealSlot: body.data.mealSlot,
      foodId: null,
      foodName: null,
      quantityG: "0",
      kcal: 0,
      proteinG: "0",
      fatG: "0",
      carbsG: "0",
      status: "draft",
      userNote: body.data.userNote ?? null,
    }).returning();

    return reply.status(201).send({
      id: entry.id,
      status: entry.status,
      nutritionDate: entry.nutritionDate,
      mealSlot: entry.mealSlot,
    });
  });

  /**
   * POST /v1/meals/:id/media/upload-url
   * Genera una URL firmada para subir un archivo de medio (foto/audio).
   */
  app.post("/v1/meals/:id/media/upload-url", {
    schema: {
      tags: ["meals-h2"],
      summary: "Obtener URL firmada para subir medio",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
      body: {
        type: "object",
        required: ["mime", "sizeBytes"],
        properties: {
          mime: { type: "string" },
          sizeBytes: { type: "integer" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            url: { type: "string" },
            objectKey: { type: "string" },
            headers: { type: "object" },
          },
        },
      },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const userId = req.user.sub;
    const { id } = req.params as { id: string };
    const { mime, sizeBytes } = req.body as { mime: string; sizeBytes: number };

    // Verificar que la entrada existe y pertenece al usuario
    const entry = await db.query.mealLogEntries.findFirst({
      where: and(eq(schema.mealLogEntries.id, id), eq(schema.mealLogEntries.userId, userId)),
    });
    if (!entry) return reply.status(404).send({ error: "entry_not_found" });

    const ext = mimeToExt(mime);
    const objectKey = generateObjectKey(userId, "meals", ext);
    const { url, headers } = await generatePresignedUploadUrl(objectKey, mime, sizeBytes);

    // Registrar el medio en la BD
    const [media] = await db.insert(schema.mealMedia).values({
      mealEntryId: id,
      type: mime.startsWith("image/") ? "image" : "audio",
      objectKey,
      mime,
      sizeBytes,
    }).returning();

    return reply.send({ url, objectKey, headers, mediaId: media.id });
  });

  /**
   * POST /v1/meals/:id/submit-for-ai
   * Marca la comida como lista para procesamiento IA y la encola.
   */
  app.post("/v1/meals/:id/submit-for-ai", {
    schema: {
      tags: ["meals-h2"],
      summary: "Enviar comida a procesamiento IA",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
      body: {
        type: "object",
        properties: {
          hasAudio: { type: "boolean" },
          hasImages: { type: "boolean" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string" },
            jobId: { type: "string" },
          },
        },
      },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const userId = req.user.sub;
    const { id } = req.params as { id: string };
    const body = SubmitForAiBody.safeParse(req.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ error: "invalid_input", details: body.error.flatten() });
    }

    const entry = await db.query.mealLogEntries.findFirst({
      where: and(eq(schema.mealLogEntries.id, id), eq(schema.mealLogEntries.userId, userId)),
      with: { media: true },
    });
    if (!entry) return reply.status(404).send({ error: "entry_not_found" });

    const mediaKeys = entry.media?.map((m) => m.objectKey) ?? [];
    if (mediaKeys.length === 0 && !body.data.hasAudio && !body.data.hasImages) {
      return reply.status(400).send({ error: "no_media_provided" });
    }

    // Cambiar estado a ai_processing
    await db
      .update(schema.mealLogEntries)
      .set({ status: "ai_processing" })
      .where(eq(schema.mealLogEntries.id, id));

    // Encolar job
    const jobId = await enqueueNutritionEstimate({
      mealEntryId: id,
      userId,
      nutritionDate: entry.nutritionDate,
      mediaKeys,
      hasAudio: body.data.hasAudio || mediaKeys.some((k) => !k.startsWith("meals/") || k.endsWith(".webm") || k.endsWith(".m4a")),
      hasImages: body.data.hasImages || mediaKeys.some((k) => k.endsWith(".jpg") || k.endsWith(".png") || k.endsWith(".webp")),
    });

    return reply.send({ status: "ai_processing", jobId });
  });

  /**
   * PATCH /v1/meals/:id/confirm
   * Confirma la estimación IA o aplica corrección manual.
   */
  app.patch("/v1/meals/:id/confirm", {
    schema: {
      tags: ["meals-h2"],
      summary: "Confirmar comida (aceptar IA o corrección manual)",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
      body: {
        type: "object",
        properties: {
          acceptAiEstimate: { type: "boolean" },
          quantityG: { type: "number" },
          kcal: { type: "number" },
          proteinG: { type: "number" },
          fatG: { type: "number" },
          carbsG: { type: "number" },
        },
      },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const userId = req.user.sub;
    const { id } = req.params as { id: string };
    const body = ConfirmMealBody.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: "invalid_input", details: body.error.flatten() });
    }

    const entry = await db.query.mealLogEntries.findFirst({
      where: and(eq(schema.mealLogEntries.id, id), eq(schema.mealLogEntries.userId, userId)),
      with: { food: true },
    });
    if (!entry) return reply.status(404).send({ error: "entry_not_found" });

    // B4: solo se puede confirmar desde pending_user_review (o ya confirmado para re-editar)
    if (entry.status === "ai_processing" || entry.status === "draft" || entry.status === "awaiting_media") {
      return reply.status(409).send({ error: "entry_not_reviewable", status: entry.status });
    }

    const updates: Record<string, unknown> = {};

    if (body.data.acceptAiEstimate) {
      // Aceptar estimación IA tal cual (ya está en los campos)
      updates.status = "confirmed";
    } else {
      // Corrección manual
      if (entry.status === "pending_user_review" || entry.status === "confirmed") {
        // Guardar snapshot previo como corrección
        await db.insert(schema.mealCorrections).values({
          mealEntryId: id,
          previousSnapshot: {
            kcal: entry.kcal,
            proteinG: Number(entry.proteinG),
            fatG: Number(entry.fatG),
            carbsG: Number(entry.carbsG),
            quantityG: Number(entry.quantityG),
          },
        });
      }

      updates.status = "confirmed";
      if (body.data.quantityG !== undefined) updates.quantityG = String(body.data.quantityG);
      if (body.data.kcal !== undefined) updates.kcal = body.data.kcal;
      if (body.data.proteinG !== undefined) updates.proteinG = String(body.data.proteinG);
      if (body.data.fatG !== undefined) updates.fatG = String(body.data.fatG);
      if (body.data.carbsG !== undefined) updates.carbsG = String(body.data.carbsG);
    }

    const [updated] = await db
      .update(schema.mealLogEntries)
      .set(updates)
      .where(eq(schema.mealLogEntries.id, id))
      .returning();

    // Upsert en food_item_observations para el catálogo incremental
    if (updated.status === "confirmed" && updated.foodName) {
      const foodNames = updated.foodName.split(",").map((n) => n.trim()).filter(Boolean);
      for (const name of foodNames) {
        const normalizedName = name.toLowerCase().trim();
        const macros = {
          kcal: updated.kcal / foodNames.length,
          proteinG: Number(updated.proteinG) / foodNames.length,
          fatG: Number(updated.fatG) / foodNames.length,
          carbsG: Number(updated.carbsG) / foodNames.length,
          quantityG: Number(updated.quantityG) / foodNames.length,
        };
        await db
          .insert(schema.foodItemObservations)
          .values({
            normalizedName,
            per100gOrServing: macros,
            sourceUserId: userId,
          })
          .onConflictDoUpdate({
            target: [schema.foodItemObservations.normalizedName],
            set: {
              seenCount: sql`${schema.foodItemObservations.seenCount} + 1`,
              lastSeenAt: new Date(),
              per100gOrServing: macros,
            },
          });
      }
    }

    return reply.send(serializeEntry({ ...updated, food: entry.food, media: [] }));
  });

  /**
   * POST /v1/meals/:id/correction
   * Registra una corrección del usuario con explicación opcional.
   */
  app.post("/v1/meals/:id/correction", {
    schema: {
      tags: ["meals-h2"],
      summary: "Registrar corrección de comida",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
      body: {
        type: "object",
        properties: {
          userExplanationText: { type: "string" },
          quantityG: { type: "number" },
          kcal: { type: "number" },
          proteinG: { type: "number" },
          fatG: { type: "number" },
          carbsG: { type: "number" },
        },
      },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const userId = req.user.sub;
    const { id } = req.params as { id: string };
    const body = CorrectionBody.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: "invalid_input", details: body.error.flatten() });
    }

    const entry = await db.query.mealLogEntries.findFirst({
      where: and(eq(schema.mealLogEntries.id, id), eq(schema.mealLogEntries.userId, userId)),
      with: { food: true },
    });
    if (!entry) return reply.status(404).send({ error: "entry_not_found" });

    // Guardar corrección
    await db.insert(schema.mealCorrections).values({
      mealEntryId: id,
      previousSnapshot: {
        kcal: entry.kcal,
        proteinG: Number(entry.proteinG),
        fatG: Number(entry.fatG),
        carbsG: Number(entry.carbsG),
        quantityG: Number(entry.quantityG),
      },
      userExplanationText: body.data.userExplanationText ?? null,
    });

    // Aplicar nuevos valores
    const updates: Record<string, unknown> = { status: "corrected" };
    if (body.data.quantityG !== undefined) updates.quantityG = String(body.data.quantityG);
    if (body.data.kcal !== undefined) updates.kcal = body.data.kcal;
    if (body.data.proteinG !== undefined) updates.proteinG = String(body.data.proteinG);
    if (body.data.fatG !== undefined) updates.fatG = String(body.data.fatG);
    if (body.data.carbsG !== undefined) updates.carbsG = String(body.data.carbsG);

    const [updated] = await db
      .update(schema.mealLogEntries)
      .set(updates)
      .where(eq(schema.mealLogEntries.id, id))
      .returning();

    return reply.send(serializeEntry({ ...updated, food: entry.food, media: [] }));
  });

  /**
   * POST /v1/meals/:id/reprocess
   * Re-procesa la comida con IA usando una nueva explicación del usuario.
   */
  app.post("/v1/meals/:id/reprocess", {
    schema: {
      tags: ["meals-h2"],
      summary: "Re-procesar comida con IA",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
      body: {
        type: "object",
        properties: {
          userExplanationText: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string" },
            jobId: { type: "string" },
          },
        },
      },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const userId = req.user.sub;
    const { id } = req.params as { id: string };

    const entry = await db.query.mealLogEntries.findFirst({
      where: and(eq(schema.mealLogEntries.id, id), eq(schema.mealLogEntries.userId, userId)),
      with: { media: true },
    });
    if (!entry) return reply.status(404).send({ error: "entry_not_found" });

    const mediaKeys = entry.media?.map((m) => m.objectKey) ?? [];

    await db
      .update(schema.mealLogEntries)
      .set({ status: "ai_processing" })
      .where(eq(schema.mealLogEntries.id, id));

    const jobId = await enqueueNutritionEstimate({
      mealEntryId: id,
      userId,
      nutritionDate: entry.nutritionDate,
      mediaKeys,
      hasAudio: mediaKeys.some((k) => k.endsWith(".webm") || k.endsWith(".m4a")),
      hasImages: mediaKeys.some((k) => k.endsWith(".jpg") || k.endsWith(".png") || k.endsWith(".webp")),
    });

    return reply.send({ status: "ai_processing", jobId });
  });

  /**
   * GET /v1/meals/:id
   * Devuelve una entrada con su estado, medios y correcciones.
   */
  app.get("/v1/meals/:id", {
    schema: {
      tags: ["meals-h2"],
      summary: "Obtener detalle de una comida",
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

    const entry = await db.query.mealLogEntries.findFirst({
      where: and(eq(schema.mealLogEntries.id, id), eq(schema.mealLogEntries.userId, userId)),
      with: {
        food: { columns: { id: true, name: true, brand: true } },
        media: { columns: { id: true, type: true, objectKey: true, mime: true } },
        corrections: { columns: { id: true, userExplanationText: true, createdAt: true } },
        aiInteractions: {
          where: eq(schema.aiInteractions.direction, "response"),
          columns: { outputParsed: true, createdAt: true },
          orderBy: (t, { asc }) => [asc(t.createdAt)],
        },
      },
    });
    if (!entry) return reply.status(404).send({ error: "entry_not_found" });

    return reply.send(serializeEntry(entry));
  });
};
