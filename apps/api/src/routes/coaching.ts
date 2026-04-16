/**
 * Rutas de coaching threads (H2).
 *
 * Hilo conversacional con ventana deslizante de 7 días.
 * - GET /v1/coaching/thread → obtiene hilo activo o crea uno nuevo
 * - POST /v1/coaching/thread/:id/messages → envía mensaje al hilo
 * - GET /v1/coaching/thread/:id/messages → historial de mensajes
 * - DELETE /v1/coaching/thread/:id → cierra/purga hilo
 */

import { and, eq, gt, desc } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import OpenAI, { toFile } from "openai";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { env } from "../lib/env.js";
import { getObjectBuffer } from "../lib/storage.js";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
    _openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return _openai;
}

const SendMessageBody = z.object({
  text: z.string().max(2000).optional(),
  audioBase64: z.string().optional(),
  imageBase64: z.string().optional(),
  imageMimeType: z.string().optional(),
  linkedMealEntryId: z.string().uuid().optional(),
});

/** Calcula la fecha de expiración: ahora + 7 días */
function computeExpiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d;
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export const coachingRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /v1/coaching/thread
   * Devuelve el hilo activo del usuario o crea uno nuevo.
   */
  app.get("/v1/coaching/thread", {
    schema: {
      tags: ["coaching"],
      summary: "Obtener hilo de coaching activo",
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: "object",
          properties: {
            id: { type: "string" },
            status: { type: "string" },
            openedAt: { type: "string" },
            lastMessageAt: { type: "string" },
            expiresAt: { type: "string" },
          },
        },
      },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const userId = req.user.sub;

    // Buscar hilo activo no expirado
    const now = new Date();
    let thread = await db.query.coachingThreads.findFirst({
      where: and(
        eq(schema.coachingThreads.userId, userId),
        eq(schema.coachingThreads.status, "active"),
        gt(schema.coachingThreads.expiresAt, now),
      ),
      orderBy: (t, { desc }) => [desc(t.lastMessageAt)],
    });

    if (!thread) {
      // Crear nuevo hilo
      const expiresAt = computeExpiresAt();
      const [created] = await db.insert(schema.coachingThreads).values({
        userId,
        expiresAt,
      }).returning();
      thread = created;
    }

    return reply.send({
      id: thread.id,
      status: thread.status,
      openedAt: thread.openedAt,
      lastMessageAt: thread.lastMessageAt,
      expiresAt: thread.expiresAt,
    });
  });

  /**
   * POST /v1/coaching/thread/:id/messages
   * Envía un mensaje al hilo. El asistente responde con GPT-4o.
   */
  app.post("/v1/coaching/thread/:id/messages", {
    schema: {
      tags: ["coaching"],
      summary: "Enviar mensaje al hilo de coaching",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
      body: {
        type: "object",
        properties: {
          text: { type: "string" },
          audioBase64: { type: "string" },
          imageBase64: { type: "string" },
          imageMimeType: { type: "string" },
          linkedMealEntryId: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            reply: { type: "string" },
            transcription: { type: "string" },
          },
        },
      },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const userId = req.user.sub;
    const { id: threadId } = req.params as { id: string };
    const body = SendMessageBody.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: "invalid_input", details: body.error.flatten() });
    }

    // Verificar hilo
    const thread = await db.query.coachingThreads.findFirst({
      where: and(
        eq(schema.coachingThreads.id, threadId),
        eq(schema.coachingThreads.userId, userId),
        eq(schema.coachingThreads.status, "active"),
      ),
    });
    if (!thread) return reply.status(404).send({ error: "thread_not_found" });

    // Validar que hay algún contenido antes de llamar al LLM
    if (!body.data.text && !body.data.audioBase64 && !body.data.imageBase64) {
      return reply.status(400).send({ error: "Debe enviarse texto, audio o imagen" });
    }

    const openai = getOpenAI();
    let userText = body.data.text ?? "";

    // Transcribir audio si se envió
    if (body.data.audioBase64) {
      const audioBuffer = Buffer.from(body.data.audioBase64, "base64");
      const audioFile = await toFile(audioBuffer, "audio.webm", { type: "audio/webm" });
      const transcription = await openai.audio.transcriptions.create({
        file: audioFile,
        model: "whisper-1",
        language: "es",
      });
      userText = transcription.text + (userText ? `\n${userText}` : "");
    }

    if (!userText && !body.data.imageBase64) {
      return reply.status(400).send({ error: "Debe enviarse texto o imagen" });
    }

    // Obtener historial del hilo (últimos 20 mensajes)
    const history = await db.query.coachingMessages.findMany({
      where: eq(schema.coachingMessages.threadId, threadId),
      orderBy: (m, { asc }) => [asc(m.createdAt)],
      limit: 20,
    });

    // Construir system prompt con contexto del día actual
    const today = new Date().toISOString().slice(0, 10);
    const todayEntries = await db.query.mealLogEntries.findMany({
      where: and(eq(schema.mealLogEntries.userId, userId), eq(schema.mealLogEntries.nutritionDate, today)),
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

    const target = await db.query.nutritionTargetSets.findFirst({
      where: and(eq(schema.nutritionTargetSets.userId, userId), eq(schema.nutritionTargetSets.isActive, true)),
    });

    const systemPrompt = `Eres el coach nutricional personal del usuario. Hoy es ${today}.
Objetivo: ${target?.kcalTarget ?? "?"} kcal | P: ${target?.proteinMinG ?? "?"}g | C: ${target?.carbsG ?? "?"}g | G: ${target?.fatMinG ?? "?"}-${target?.fatMaxG ?? "?"}g
Consumido hoy: ${consumed.kcal} kcal | P:${consumed.proteinG.toFixed(0)}g G:${consumed.fatG.toFixed(0)}g C:${consumed.carbsG.toFixed(0)}g
Responde en español, sé breve (2-3 frases), amigable y práctico.`;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...history.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.bodyText,
      })),
    ];

    // Mensaje del usuario con imagen si aplica
    if (body.data.imageBase64) {
      const mimeType = body.data.imageMimeType ?? "image/jpeg";
      messages.push({
        role: "user",
        content: [
          { type: "text", text: userText || "Analiza esta imagen." },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${body.data.imageBase64}`, detail: "low" } },
        ],
      });
    } else {
      messages.push({ role: "user", content: userText });
    }

    // B5: las imágenes de coaching se envían inline a OpenAI pero NO se suben a object storage.
    // El campo attachmentObjectKey se deja null intencionalmente para evitar que el purge worker
    // intente borrar objetos que nunca existieron.
    await db.insert(schema.coachingMessages).values({
      threadId,
      role: "user",
      bodyText: userText,
      linkedMealEntryId: body.data.linkedMealEntryId ?? null,
      attachmentObjectKey: null,
    });

    // Llamar al modelo
    let response: OpenAI.Chat.ChatCompletion;
    try {
      response = await openai.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages,
        max_tokens: 512,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      app.log.error({ err }, "OpenAI coaching error");
      return reply.status(502).send({ error: `Error del coach: ${msg}` });
    }

    const assistantContent = response.choices[0].message.content ?? "";

    // Guardar respuesta del asistente
    await db.insert(schema.coachingMessages).values({
      threadId,
      role: "assistant",
      bodyText: assistantContent,
    });

    // Actualizar hilo
    await db
      .update(schema.coachingThreads)
      .set({
        lastMessageAt: new Date(),
        expiresAt: computeExpiresAt(),
      })
      .where(eq(schema.coachingThreads.id, threadId));

    return reply.send({
      reply: assistantContent,
      transcription: body.data.audioBase64 ? userText : undefined,
    });
  });

  /**
   * GET /v1/coaching/thread/:id/messages
   * Historial de mensajes del hilo.
   */
  app.get("/v1/coaching/thread/:id/messages", {
    schema: {
      tags: ["coaching"],
      summary: "Historial de mensajes del hilo",
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
    const { id: threadId } = req.params as { id: string };

    const thread = await db.query.coachingThreads.findFirst({
      where: and(
        eq(schema.coachingThreads.id, threadId),
        eq(schema.coachingThreads.userId, userId),
      ),
    });
    if (!thread) return reply.status(404).send({ error: "thread_not_found" });

    const messages = await db.query.coachingMessages.findMany({
      where: eq(schema.coachingMessages.threadId, threadId),
      orderBy: (m, { asc }) => [asc(m.createdAt)],
    });

    return reply.send({
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        bodyText: m.bodyText,
        linkedMealEntryId: m.linkedMealEntryId,
        createdAt: m.createdAt,
      })),
    });
  });

  /**
   * DELETE /v1/coaching/thread/:id
   * Cierra un hilo de coaching (marca como purged).
   */
  app.delete("/v1/coaching/thread/:id", {
    schema: {
      tags: ["coaching"],
      summary: "Cerrar hilo de coaching",
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
    const userId = req.user.sub;
    const { id: threadId } = req.params as { id: string };

    const deleted = await db
      .update(schema.coachingThreads)
      .set({ status: "purged" })
      .where(and(
        eq(schema.coachingThreads.id, threadId),
        eq(schema.coachingThreads.userId, userId),
      ))
      .returning({ id: schema.coachingThreads.id });

    if (!deleted.length) return reply.status(404).send({ error: "thread_not_found" });
    return reply.send({ ok: true });
  });
};
