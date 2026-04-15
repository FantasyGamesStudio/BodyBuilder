import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import OpenAI, { toFile } from "openai";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { env } from "../lib/env.js";

// ─── OpenAI client (lazy init para no fallar si no hay API key en tests) ──────

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
    _openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return _openai;
}

// ─── Tool definitions para GPT-4o ─────────────────────────────────────────────

const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "add_meal_entries",
      description:
        "Registra una o varias entradas de comida en el diario del usuario. " +
        "Llama a esta función siempre que el usuario describa algo que comió, está comiendo o va a comer. " +
        "Desglosa en entradas individuales (ej. bocadillo + café = 2 entradas). " +
        "Estima porciones estándar si no se especifican.",
      parameters: {
        type: "object",
        required: ["entries"],
        properties: {
          entries: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "mealSlot", "quantityG", "kcal", "proteinG", "fatG", "carbsG"],
              properties: {
                name: { type: "string", description: "Nombre del alimento (ej. 'Bocadillo de jamón serrano')" },
                mealSlot: {
                  type: "string",
                  enum: ["breakfast", "lunch", "dinner", "snack", "other"],
                  description: "Momento del día. Infiere del contexto si no se indica.",
                },
                quantityG: { type: "number", description: "Cantidad en gramos (o ml para líquidos)" },
                kcal: { type: "number", description: "Calorías totales estimadas" },
                proteinG: { type: "number", description: "Proteínas en gramos" },
                fatG: { type: "number", description: "Grasas en gramos" },
                carbsG: { type: "number", description: "Carbohidratos en gramos" },
              },
            },
          },
        },
      },
    },
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SLOT_ES: Record<string, string> = {
  breakfast: "Desayuno",
  lunch: "Comida",
  dinner: "Cena",
  snack: "Snack",
  other: "Otro",
};

/** Construye el system prompt con el contexto nutricional del día. */
async function buildSystemPrompt(userId: string, date: string): Promise<string> {
  // Perfil y objetivo activo
  const [profile, target] = await Promise.all([
    db.query.userProfiles.findFirst({ where: eq(schema.userProfiles.userId, userId) }),
    db.query.nutritionTargetSets.findFirst({
      where: and(eq(schema.nutritionTargetSets.userId, userId), eq(schema.nutritionTargetSets.isActive, true)),
    }),
  ]);

  // Progreso del día actual
  const todayEntries = await db.query.mealLogEntries.findMany({
    where: and(eq(schema.mealLogEntries.userId, userId), eq(schema.mealLogEntries.nutritionDate, date)),
  });
  const todayWorkouts = await db.query.workoutLogs.findMany({
    where: and(eq(schema.workoutLogs.userId, userId), eq(schema.workoutLogs.workoutDate, date)),
  });

  // Necesitamos los nombres de los alimentos para mostrar al LLM qué ya está registrado
  const todayEntriesWithFood = await db.query.mealLogEntries.findMany({
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
  const eatKcal = todayWorkouts.reduce((s, w) => s + w.kcalBurned, 0);
  const kcalTarget = (target?.kcalTarget ?? 2000) + eatKcal;
  const remaining = kcalTarget - consumed.kcal;

  // Últimos 3 días para contexto histórico
  const threeDaysAgo = new Date(date + "T00:00:00");
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const pastEntries = await db.query.mealLogEntries.findMany({
    where: and(
      eq(schema.mealLogEntries.userId, userId),
      gte(schema.mealLogEntries.nutritionDate, threeDaysAgo.toISOString().slice(0, 10)),
    ),
    orderBy: [desc(schema.mealLogEntries.nutritionDate)],
  });

  // Agrupar por día
  const byDay: Record<string, { kcal: number; proteinG: number; fatG: number; carbsG: number }> = {};
  for (const e of pastEntries) {
    if (e.nutritionDate === date) continue;
    byDay[e.nutritionDate] ??= { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 };
    byDay[e.nutritionDate].kcal += e.kcal;
    byDay[e.nutritionDate].proteinG += Number(e.proteinG);
    byDay[e.nutritionDate].fatG += Number(e.fatG);
    byDay[e.nutritionDate].carbsG += Number(e.carbsG);
  }

  const historySummary = Object.entries(byDay)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([d, v]) =>
      `  ${d}: ${v.kcal} kcal | P:${v.proteinG.toFixed(0)}g G:${v.fatG.toFixed(0)}g C:${v.carbsG.toFixed(0)}g`,
    )
    .join("\n") || "  Sin datos anteriores";

  const nickname = profile?.nickname ?? "Usuario";
  const goalMode = target ? `Objetivo: ${target.kcalTarget} kcal` : "Sin objetivo configurado";

  const SLOT_NAMES: Record<string, string> = {
    breakfast: "Desayuno", lunch: "Comida", dinner: "Cena", snack: "Snack", other: "Otro",
  };
  const registeredList = todayEntriesWithFood.length > 0
    ? todayEntriesWithFood
        .map((e) => `  - ${SLOT_NAMES[e.mealSlot] ?? e.mealSlot}: ${e.food?.name ?? "Alimento"} (${e.kcal} kcal)`)
        .join("\n")
    : "  Ninguna entrada registrada aún.";

  return `Eres el asesor nutricional personal de ${nickname} para hoy, ${date}.
Eres directo, amigable y práctico. Responde siempre en español.

OBJETIVO DIARIO:
  ${goalMode}
  Proteína mín: ${target?.proteinMinG ?? "?"}g | Carbos: ${target?.carbsG ?? "?"}g | Grasas: ${target?.fatMinG ?? "?"}–${target?.fatMaxG ?? "?"}g
  ${eatKcal > 0 ? `Entrenamiento del día: +${eatKcal} kcal (target ajustado: ${kcalTarget} kcal)` : ""}

PROGRESO HOY (${date}):
  Consumido: ${consumed.kcal} kcal | P:${consumed.proteinG.toFixed(0)}g G:${consumed.fatG.toFixed(0)}g C:${consumed.carbsG.toFixed(0)}g
  Restante: ${remaining} kcal

ENTRADAS YA REGISTRADAS HOY (NO las vuelvas a añadir aunque el usuario las mencione de nuevo):
${registeredList}

HISTORIAL ÚLTIMOS 3 DÍAS:
${historySummary}

INSTRUCCIONES:
- Cuando el usuario describa comidas (pasadas o presentes), usa add_meal_entries() inmediatamente.
- REGLA DE AGRUPADO: crea UNA entrada por alimento/plato diferente que se come por separado.
  - Si varios ingredientes se mezclan en una sola preparación (un batido, un café con leche, unas tostadas con mantequilla), es UNA entrada con los macros sumados.
  - Solo desglosa si los alimentos se toman por separado (ej. un bocadillo Y una fruta = 2 entradas).
  - Ejemplos correctos:
    · "leche con colacao y proteína" → 1 entrada: "Batido de leche con colacao y proteína"
    · "café con leche" → 1 entrada: "Café con leche"
    · "tostadas con aceite y tomate" → 1 entrada: "Tostadas con aceite y tomate"
    · "pitufo de jamón y un café" → 2 entradas: pitufo de jamón + café
- Estima porciones estándar si no se especifican.
- Usa el mealSlot correcto según el contexto (hora del día o lo que diga el usuario).
- Si ves patrones problemáticos en el historial (exceso de grasa, déficit de proteína...), coméntalo brevemente.
- Si el usuario pide sugerencias, propón opciones que cuadren con los macros restantes.
- Sé breve: 2-3 frases máximo salvo que te pidan más detalle.
- No repitas los valores numéricos que ya has registrado, solo confirma lo añadido con el nombre.`;
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

export const advisorRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /v1/advisor/:date/history
   * Devuelve el historial de mensajes del asesor para una fecha.
   */
  app.get("/v1/advisor/:date/history", {
    schema: {
      tags: ["advisor"],
      summary: "Historial de conversación del asesor para un día",
      security: [{ bearerAuth: [] }],
      params: { type: "object", required: ["date"], properties: { date: { type: "string" } } },
      response: {
        200: {
          type: "object",
          properties: {
            messages: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  role: { type: "string" },
                  content: { type: "string" },
                  createdAt: { type: "string" },
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
    const { date } = req.params as { date: string };

    const messages = await db.query.advisorMessages.findMany({
      where: and(
        eq(schema.advisorMessages.userId, userId),
        eq(schema.advisorMessages.conversationDate, date),
      ),
      orderBy: (m, { asc }) => [asc(m.createdAt)],
    });

    return reply.send({ messages });
  });

  /**
   * POST /v1/advisor/transcribe
   * Transcribe un audio con Whisper y devuelve el texto. No guarda nada.
   */
  app.post("/v1/advisor/transcribe", {
    schema: {
      tags: ["advisor"],
      summary: "Transcribir audio con Whisper",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["audioBase64"],
        properties: {
          audioBase64: { type: "string" },
          mimeType: { type: "string" },
        },
      },
      response: { 200: { type: "object", properties: { text: { type: "string" } } } },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const { audioBase64, mimeType = "audio/webm" } = req.body as { audioBase64: string; mimeType?: string };
    const openai = getOpenAI();
    try {
      const audioBuffer = Buffer.from(audioBase64, "base64");
      const audioFile = await toFile(audioBuffer, "audio.webm", { type: mimeType });
      const transcription = await openai.audio.transcriptions.create({
        file: audioFile,
        model: "whisper-1",
        language: "es",
      });
      return reply.send({ text: transcription.text });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(502).send({ error: `Error al transcribir: ${msg}` });
    }
  });

  /**
   * POST /v1/advisor/:date/message
   * Envía un mensaje al asesor (texto, audio base64 o imagen base64).
   * El asesor puede registrar comidas automáticamente via function calling.
   */
  app.post("/v1/advisor/:date/message", {
    schema: {
      tags: ["advisor"],
      summary: "Enviar mensaje al asesor IA",
      security: [{ bearerAuth: [] }],
      params: { type: "object", required: ["date"], properties: { date: { type: "string" } } },
      body: {
        type: "object",
        properties: {
          text: { type: "string", maxLength: 2000 },
          audioBase64: { type: "string", description: "Audio en base64 (webm/mp4) para transcribir con Whisper" },
          imageBase64: { type: "string", description: "Imagen en base64 (jpeg/png/webp)" },
          imageMimeType: { type: "string" },
        },
      },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const userId = req.user.sub;
    const { date } = req.params as { date: string };
    const { text, audioBase64, imageBase64, imageMimeType } = req.body as {
      text?: string;
      audioBase64?: string;
      imageBase64?: string;
      imageMimeType?: string;
    };

    if (!text && !audioBase64 && !imageBase64) {
      return reply.status(400).send({ error: "Debe enviarse texto, audio o imagen" });
    }

    const openai = getOpenAI();
    let userText = text ?? "";

    // ── 1. Transcribir audio con Whisper si se envió ──────────────────────────
    if (audioBase64) {
      const audioBuffer = Buffer.from(audioBase64, "base64");
      const audioFile = await toFile(audioBuffer, "audio.webm", { type: "audio/webm" });
      const transcription = await openai.audio.transcriptions.create({
        file: audioFile,
        model: "whisper-1",
        language: "es",
      });
      userText = transcription.text + (userText ? `\n${userText}` : "");
    }

    // ── 2. Obtener historial de la conversación del día ───────────────────────
    const history = await db.query.advisorMessages.findMany({
      where: and(
        eq(schema.advisorMessages.userId, userId),
        eq(schema.advisorMessages.conversationDate, date),
      ),
      orderBy: (m, { asc }) => [asc(m.createdAt)],
    });

    // ── 3. Construir mensajes para la API ─────────────────────────────────────
    const systemPrompt = await buildSystemPrompt(userId, date);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...history.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    // Mensaje del usuario actual (puede incluir imagen)
    if (imageBase64) {
      messages.push({
        role: "user",
        content: [
          ...(userText ? [{ type: "text" as const, text: userText }] : []),
          {
            type: "image_url" as const,
            image_url: { url: `data:${imageMimeType ?? "image/jpeg"};base64,${imageBase64}` },
          },
        ],
      });
    } else {
      messages.push({ role: "user", content: userText });
    }

    // ── 4. Llamar al modelo ───────────────────────────────────────────────────
    let response: OpenAI.Chat.ChatCompletion;
    try {
      response = await openai.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages,
        tools,
        tool_choice: "auto",
        max_tokens: 1024,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      app.log.error({ err }, "OpenAI chat error");
      return reply.status(502).send({ error: `Error al contactar con el modelo de IA: ${msg}` });
    }

    const assistantMessage = response.choices[0].message;
    const addedEntries: Array<{
      id: string; name: string; mealSlot: string; quantityG: number;
      kcal: number; proteinG: number; fatG: number; carbsG: number;
    }> = [];

    // ── 5. Ejecutar tool calls (add_meal_entries) ─────────────────────────────
    if (assistantMessage.tool_calls?.length) {
      const toolResults: OpenAI.Chat.ChatCompletionMessageParam[] = [assistantMessage];

      for (const toolCall of assistantMessage.tool_calls) {
        if (toolCall.function.name !== "add_meal_entries") continue;

        const args = JSON.parse(toolCall.function.arguments) as {
          entries: Array<{
            name: string; mealSlot: string; quantityG: number;
            kcal: number; proteinG: number; fatG: number; carbsG: number;
          }>;
        };

        const inserted: string[] = [];
        for (const entry of args.entries) {
          const [row] = await db.insert(schema.mealLogEntries).values({
            userId,
            foodId: null,
            foodName: entry.name,
            nutritionDate: date,
            mealSlot: entry.mealSlot,
            quantityG: String(entry.quantityG),
            kcal: Math.round(entry.kcal),
            proteinG: String(entry.proteinG),
            fatG: String(entry.fatG),
            carbsG: String(entry.carbsG),
          }).returning();

          addedEntries.push({
            id: row.id,
            name: entry.name,
            mealSlot: entry.mealSlot,
            quantityG: entry.quantityG,
            kcal: Math.round(entry.kcal),
            proteinG: entry.proteinG,
            fatG: entry.fatG,
            carbsG: entry.carbsG,
          });
          inserted.push(`${entry.name} (${SLOT_ES[entry.mealSlot] ?? entry.mealSlot}, ${Math.round(entry.kcal)} kcal)`);
        }

        toolResults.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: `Entradas registradas: ${inserted.join(", ")}`,
        });
      }

      // Segunda llamada para obtener la respuesta final del asesor
      let followUp: OpenAI.Chat.ChatCompletion;
      try {
        followUp = await openai.chat.completions.create({
          model: env.OPENAI_MODEL,
          messages: [...messages, ...toolResults],
          max_tokens: 512,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        app.log.error({ err }, "OpenAI follow-up error");
        return reply.status(502).send({ error: `Error al generar respuesta del asesor: ${msg}` });
      }

      const finalContent = followUp.choices[0].message.content ?? "";

      await db.insert(schema.advisorMessages).values([
        { userId, conversationDate: date, role: "user", content: userText },
        { userId, conversationDate: date, role: "assistant", content: finalContent },
      ]);

      return reply.send({ reply: finalContent, addedEntries, transcription: audioBase64 ? userText : undefined });
    }

    // Sin tool calls: solo respuesta conversacional
    const replyContent = assistantMessage.content ?? "";

    await db.insert(schema.advisorMessages).values([
      { userId, conversationDate: date, role: "user", content: userText },
      { userId, conversationDate: date, role: "assistant", content: replyContent },
    ]);

    return reply.send({ reply: replyContent, addedEntries: [], transcription: audioBase64 ? userText : undefined });
  });

  /**
   * GET /v1/advisor/recurring
   * Lista los alimentos recurrentes del usuario (ordenados por uso reciente).
   */
  app.get("/v1/advisor/recurring", {
    schema: {
      tags: ["advisor"],
      summary: "Listar alimentos recurrentes del usuario",
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  description: { type: ["string", "null"] },
                  kcalPerServing: { type: "integer" },
                  proteinG: { type: "number" },
                  fatG: { type: "number" },
                  carbsG: { type: "number" },
                  quantityG: { type: "number" },
                  mealSlot: { type: "string" },
                  timesUsed: { type: "integer" },
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
    const items = await db.query.recurringFoods.findMany({
      where: eq(schema.recurringFoods.userId, userId),
      orderBy: (r, { desc }) => [desc(r.lastUsedAt)],
      limit: 20,
    });

    return reply.send({
      items: items.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        kcalPerServing: r.kcalPerServing,
        proteinG: Number(r.proteinG),
        fatG: Number(r.fatG),
        carbsG: Number(r.carbsG),
        quantityG: Number(r.quantityG),
        mealSlot: r.mealSlot,
        timesUsed: r.timesUsed,
      })),
    });
  });

  /**
   * POST /v1/advisor/recurring
   * Marca una entrada de comida como recurrente (o actualiza si ya existe).
   */
  app.post("/v1/advisor/recurring", {
    schema: {
      tags: ["advisor"],
      summary: "Guardar alimento como recurrente",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["mealEntryId"],
        properties: { mealEntryId: { type: "string", format: "uuid" } },
      },
      response: { 201: { type: "object", properties: { id: { type: "string" } } } },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const userId = req.user.sub;
    const { mealEntryId } = req.body as { mealEntryId: string };

    const entry = await db.query.mealLogEntries.findFirst({
      where: and(eq(schema.mealLogEntries.id, mealEntryId), eq(schema.mealLogEntries.userId, userId)),
    });
    if (!entry) return reply.status(404).send({ error: "entry_not_found" });

    const name = entry.foodName ?? "Alimento";

    // Buscar si ya existe con el mismo nombre para incrementar timesUsed
    const existing = await db.query.recurringFoods.findFirst({
      where: and(
        eq(schema.recurringFoods.userId, userId),
        sql`lower(${schema.recurringFoods.name}) = lower(${name})`,
      ),
    });

    if (existing) {
      await db.update(schema.recurringFoods)
        .set({ timesUsed: existing.timesUsed + 1, lastUsedAt: new Date() })
        .where(eq(schema.recurringFoods.id, existing.id));
      return reply.status(201).send({ id: existing.id });
    }

    const [created] = await db.insert(schema.recurringFoods).values({
      userId,
      name,
      kcalPerServing: entry.kcal,
      proteinG: entry.proteinG,
      fatG: entry.fatG,
      carbsG: entry.carbsG,
      quantityG: entry.quantityG,
      mealSlot: entry.mealSlot,
    }).returning({ id: schema.recurringFoods.id });

    return reply.status(201).send({ id: created.id });
  });

  /**
   * DELETE /v1/advisor/recurring/:id
   * Elimina un alimento recurrente del usuario.
   */
  app.delete("/v1/advisor/recurring/:id", {
    schema: {
      tags: ["advisor"],
      summary: "Eliminar alimento recurrente",
      security: [{ bearerAuth: [] }],
      params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
      response: { 200: { type: "object", properties: { ok: { type: "boolean" } } } },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const userId = req.user.sub;
    const { id } = req.params as { id: string };

    const deleted = await db
      .delete(schema.recurringFoods)
      .where(and(eq(schema.recurringFoods.id, id), eq(schema.recurringFoods.userId, userId)))
      .returning({ id: schema.recurringFoods.id });

    if (!deleted.length) return reply.status(404).send({ error: "not_found" });
    return reply.send({ ok: true });
  });

  /**
   * POST /v1/advisor/recurring/:id/log
   * Re-añade un alimento recurrente al día indicado.
   */
  app.post("/v1/advisor/recurring/:id/log", {
    schema: {
      tags: ["advisor"],
      summary: "Añadir alimento recurrente al día",
      security: [{ bearerAuth: [] }],
      params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
      body: {
        type: "object",
        required: ["nutritionDate"],
        properties: {
          nutritionDate: { type: "string" },
          mealSlot: { type: "string" },
        },
      },
      response: { 201: { type: "object", properties: { id: { type: "string" } } } },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const userId = req.user.sub;
    const { id } = req.params as { id: string };
    const { nutritionDate, mealSlot } = req.body as { nutritionDate: string; mealSlot?: string };

    const recurring = await db.query.recurringFoods.findFirst({
      where: and(eq(schema.recurringFoods.id, id), eq(schema.recurringFoods.userId, userId)),
    });
    if (!recurring) return reply.status(404).send({ error: "not_found" });

    const [entry] = await db.insert(schema.mealLogEntries).values({
      userId,
      foodId: null,
      foodName: recurring.name,
      nutritionDate,
      mealSlot: mealSlot ?? recurring.mealSlot,
      quantityG: recurring.quantityG,
      kcal: recurring.kcalPerServing,
      proteinG: recurring.proteinG,
      fatG: recurring.fatG,
      carbsG: recurring.carbsG,
    }).returning({ id: schema.mealLogEntries.id });

    await db.update(schema.recurringFoods)
      .set({ timesUsed: recurring.timesUsed + 1, lastUsedAt: new Date() })
      .where(eq(schema.recurringFoods.id, id));

    return reply.status(201).send({ id: entry.id });
  });
};
