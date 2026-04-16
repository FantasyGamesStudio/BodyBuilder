/**
 * Worker de IA: procesa la cola nutrition-estimate.
 *
 * Pipeline:
 * 1. Descarga medios desde S3
 * 2. Si hay audio → STT con Whisper
 * 3. Si hay imágenes → visión con GPT-4o
 * 4. Unifica todo en prompt → LLM con JSON schema
 * 5. Persiste meal_nutrition, ai_interaction, cambia status a pending_user_review
 */

import { Worker, Job } from "bullmq";
import { Redis } from "ioredis";
import OpenAI, { toFile } from "openai";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { env } from "../lib/env.js";
import { getObjectBuffer, deleteObject } from "../lib/storage.js";
import type { NutritionEstimateJob } from "../lib/queue.js";

function getOpenAI(): OpenAI {
  return new OpenAI({ apiKey: env.OPENAI_API_KEY });
}

// ─── Esquema JSON esperado del LLM ────────────────────────────────────────────

const nutritionSchema = {
  type: "object",
  required: ["line_items", "totals"],
  properties: {
    meal_summary: { type: "string" },
    line_items: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "kcal", "protein_g", "carbs_g", "fat_g"],
        properties: {
          name: { type: "string" },
          estimated_grams: { type: "number" },
          kcal: { type: "number" },
          protein_g: { type: "number" },
          carbs_g: { type: "number" },
          fat_g: { type: "number" },
        },
      },
    },
    totals: {
      type: "object",
      required: ["kcal", "protein_g", "carbs_g", "fat_g", "confidence"],
      properties: {
        kcal: { type: "number" },
        protein_g: { type: "number" },
        carbs_g: { type: "number" },
        fat_g: { type: "number" },
        confidence: { type: "number" },
      },
    },
    day_feedback: { type: "string" },
    assumptions: { type: "array", items: { type: "string" } },
    disclaimer: { type: "string" },
  },
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Construye el contexto nutricional del día para el prompt. */
async function buildNutritionContext(userId: string, date: string): Promise<string> {
  const [profile, target] = await Promise.all([
    db.query.userProfiles.findFirst({ where: eq(schema.userProfiles.userId, userId) }),
    db.query.nutritionTargetSets.findFirst({
      where: and(eq(schema.nutritionTargetSets.userId, userId), eq(schema.nutritionTargetSets.isActive, true)),
    }),
  ]);

  const todayEntries = await db.query.mealLogEntries.findMany({
    where: and(eq(schema.mealLogEntries.userId, userId), eq(schema.mealLogEntries.nutritionDate, date)),
    with: { food: true },
  });

  const consumed = todayEntries.reduce(
    (acc, e) => ({
      kcal: acc.kcal + e.kcal,
      proteinG: acc.proteinG + Number(e.proteinG),
      fatG: acc.fatG + Number(e.fatG),
      carbsG: acc.carbsG + Number(e.carbsG),
    }),
    { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 },
  );

  const nickname = profile?.nickname ?? "Usuario";
  const entriesList = todayEntries.length > 0
    ? todayEntries.map((e) => `- ${e.food?.name ?? e.foodName ?? "Alimento"} (${e.kcal} kcal)`).join("\n")
    : "Ninguna entrada registrada aún.";

  return `Contexto de ${nickname} para ${date}:
Objetivo: ${target?.kcalTarget ?? "?"} kcal | P: ${target?.proteinMinG ?? "?"}g | C: ${target?.carbsG ?? "?"}g | G: ${target?.fatMinG ?? "?"}-${target?.fatMaxG ?? "?"}g
Consumido hoy: ${consumed.kcal} kcal | P:${consumed.proteinG.toFixed(0)}g G:${consumed.fatG.toFixed(0)}g C:${consumed.carbsG.toFixed(0)}g
Entradas ya registradas:
${entriesList}`;
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export function createNutritionWorker(): Worker {
  const worker = new Worker<NutritionEstimateJob>(
    "nutrition-estimate",
    async (job: Job<NutritionEstimateJob>) => {
      const { mealEntryId, userId, nutritionDate, mediaKeys, hasAudio, hasImages } = job.data;
      const startMs = Date.now();
      const openai = getOpenAI();

      // 1. Descargar medios
      let audioBuffer: Buffer | null = null;
      const imageBuffers: Array<{ buffer: Buffer; mime: string }> = [];

      for (const key of mediaKeys) {
        const buf = await getObjectBuffer(key);
        if (key.startsWith("meals/") && (key.endsWith(".webm") || key.endsWith(".m4a") || key.endsWith(".mp3"))) {
          audioBuffer = buf;
        } else {
          const ext = key.split(".").pop() ?? "jpeg";
          const mimeMap: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
          imageBuffers.push({ buffer: buf, mime: mimeMap[ext] ?? "image/jpeg" });
        }
      }

      // 2. STT si hay audio
      let transcript = "";
      if (audioBuffer && hasAudio) {
        const audioFile = await toFile(audioBuffer, "audio.webm", { type: "audio/webm" });
        const transcription = await openai.audio.transcriptions.create({
          file: audioFile,
          model: "whisper-1",
          language: "es",
        });
        transcript = transcription.text;
      }

      // 3. Contexto del día
      const context = await buildNutritionContext(userId, nutritionDate);

      // 4. Construir mensajes para GPT-4o
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        {
          role: "system",
          content: `Eres un asistente de nutrición experto. Analiza las imágenes y/o descripción de audio de una comida y estima los macros (kcal, proteína, carbohidratos, grasa).
Devuelve SOLO JSON válido siguiendo este esquema:
${JSON.stringify(nutritionSchema, null, 2)}

Reglas:
- Estima porciones estándar si no se especifican.
- Crea un line_item por alimento/plato diferente.
- Si varios ingredientes se mezclan (café con leche, tostadas con tomate), es UN line_item.
- confidence: 0-1 según tu certeza.
- Responde en español en meal_summary y day_feedback.
- No incluyas texto fuera del JSON.`,
        },
      ];

      // Contenido del usuario (imágenes + transcript)
      const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

      if (transcript) {
        userContent.push({ type: "text", text: `Descripción de audio: "${transcript}"` });
      }

      for (const img of imageBuffers) {
        const base64 = img.buffer.toString("base64");
        userContent.push({
          type: "image_url",
          image_url: { url: `data:${img.mime};base64,${base64}` },
        });
      }

      if (userContent.length === 0) {
        userContent.push({ type: "text", text: "Analiza esta comida." });
      }

      messages.push({ role: "user", content: userContent as unknown as string });
      messages.push({ role: "user", content: context });

      // 5. Llamar al modelo
      const response = await openai.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages,
        response_format: { type: "json_object" },
        max_tokens: 1024,
      });

      const latencyMs = Date.now() - startMs;
      const outputText = response.choices[0].message.content ?? "{}";

      // 6. Parsear JSON
      let parsed: {
        totals: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; confidence: number };
        line_items: Array<{ name: string; estimated_grams?: number; kcal: number; protein_g: number; carbs_g: number; fat_g: number }>;
      };

      try {
        parsed = JSON.parse(outputText);
      } catch {
        throw new Error("El modelo no devolvió JSON válido");
      }

      // 7. Actualizar la entrada con los macros estimados
      const totals = parsed.totals;
      const [updated] = await db
        .update(schema.mealLogEntries)
        .set({
          status: "pending_user_review",
          foodName: parsed.line_items.map((l) => l.name).join(", "),
          quantityG: String(parsed.line_items.reduce((s, l) => s + (l.estimated_grams ?? 0), 0)),
          kcal: Math.round(totals.kcal),
          proteinG: String(totals.protein_g),
          fatG: String(totals.fat_g),
          carbsG: String(totals.carbs_g),
        })
        .where(eq(schema.mealLogEntries.id, mealEntryId))
        .returning();

      // 8. Persistir ai_interaction
      await db.insert(schema.aiInteractions).values({
        mealEntryId,
        direction: "response",
        modelId: env.OPENAI_MODEL,
        openrouterRequestId: response.id,
        inputSummary: JSON.stringify({
          mediaCount: mediaKeys.length,
          hasAudio,
          hasImages,
          transcript: transcript.slice(0, 500),
        }),
        outputRaw: outputText,
        outputParsed: parsed,
        latencyMs,
        tokenUsage: response.usage
          ? { input_tokens: response.usage.prompt_tokens, output_tokens: response.usage.completion_tokens, total: response.usage.total_tokens }
          : null,
      });

      return { mealEntryId, status: "pending_user_review" };
    },
    {
      connection: new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }),
      concurrency: 3,
    },
  );

  worker.on("completed", (job: Job<unknown, unknown, string> | undefined) => {
    if (job) console.log(`✅ Job ${job.id} completado: ${JSON.stringify(job.returnvalue)}`);
  });

  worker.on("failed", (job: Job<unknown, unknown, string> | undefined, err: Error) => {
    console.error(`❌ Job ${job?.id} falló: ${err.message}`);
  });

  return worker;
}
