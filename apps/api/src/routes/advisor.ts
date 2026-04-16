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

const GOAL_MODE_ES: Record<string, string> = {
  volumen_limpio: "Volumen limpio (superávit calórico, prioridad hipertrofia)",
  mantenimiento: "Mantenimiento (peso estable)",
  definicion: "Definición (déficit calórico, preservar músculo)",
  recomposicion: "Recomposición (déficit leve + alta proteína)",
  perdida_peso: "Pérdida de peso (déficit calórico)",
};

const GOAL_MODE_ADVICE: Record<string, string> = {
  volumen_limpio:
    "El superávit se reparte PRIORITARIAMENTE en carbohidratos (tras cubrir proteína y grasa mínima). " +
    "En días de entreno: más carbos para rendimiento y recuperación. " +
    "Cuando el usuario pregunte cuánto comer, dale GRAMOS CONCRETOS de cada alimento basándote en los macros restantes, " +
    "redondeando a porciones prácticas (ej. 150g de arroz cocido, no 147g). " +
    "Si hoy entrena, sugiere que la comida pre-entreno sea rica en carbos de absorción media y la post-entreno incluya proteína + carbos.",
  mantenimiento:
    "Mantener peso estable con banda estrecha. " +
    "Cuando el usuario pregunte cuánto comer, dale GRAMOS CONCRETOS basándote en los macros restantes, " +
    "redondeando a porciones prácticas (ej. 150g de pechuga, no 147g).",
  definicion:
    "El déficit NO se compensa con el movimiento (no 'comer de vuelta' el entreno). " +
    "Prioridad: proteína al objetivo, grasa al mínimo saludable, el resto carbos. " +
    "Cuando el usuario pregunte cuánto comer, dale GRAMOS CONCRETOS basándote en los macros restantes, " +
    "redondeando a porciones prácticas. " +
    "Sugiere alimentos con alto volumen/saciedad por pocas kcal (verduras, proteínas magras).",
  recomposicion:
    "Similar a déficit leve con proteína alta. " +
    "Cuando el usuario pregunte cuánto comer, dale GRAMOS CONCRETOS basándote en los macros restantes, " +
    "redondeando a porciones prácticas. " +
    "El entreno de fuerza es clave; sugiere proteína + carbos moderados alrededor del entreno.",
  perdida_peso:
    "El déficit NO se compensa con el movimiento. " +
    "Cuando el usuario pregunte cuánto comer, dale GRAMOS CONCRETOS basándote en los macros restantes, " +
    "redondeando a porciones prácticas. " +
    "Sugiere alimentos con alto volumen/saciedad por pocas kcal.",
};

const ACTIVITY_ES: Record<string, string> = {
  sedentary: "Sedentario",
  lightly_active: "Ligeramente activo",
  moderately_active: "Moderadamente activo",
  very_active: "Muy activo",
  extra_active: "Extra activo",
};

/** Construye el system prompt con el contexto nutricional del día. */
async function buildSystemPrompt(userId: string, date: string): Promise<string> {
  const [profile, target, onboarding] = await Promise.all([
    db.query.userProfiles.findFirst({ where: eq(schema.userProfiles.userId, userId) }),
    db.query.nutritionTargetSets.findFirst({
      where: and(eq(schema.nutritionTargetSets.userId, userId), eq(schema.nutritionTargetSets.isActive, true)),
    }),
    db.query.userOnboardings.findFirst({
      where: eq(schema.userOnboardings.userId, userId),
      orderBy: (o, { desc: d }) => [d(o.createdAt)],
    }),
  ]);

  const todayEntries = await db.query.mealLogEntries.findMany({
    where: and(eq(schema.mealLogEntries.userId, userId), eq(schema.mealLogEntries.nutritionDate, date)),
    with: { food: true },
  });

  const todayWorkouts = await db.query.workoutLogs.findMany({
    where: and(eq(schema.workoutLogs.userId, userId), eq(schema.workoutLogs.workoutDate, date)),
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
  const remainingKcal = kcalTarget - consumed.kcal;
  const remainingProtein = (target?.proteinMinG ?? 0) - consumed.proteinG;
  const remainingCarbs = (target?.carbsG ?? 0) - consumed.carbsG;
  const remainingFatMin = (target?.fatMinG ?? 0) - consumed.fatG;
  const remainingFatMax = (target?.fatMaxG ?? 0) - consumed.fatG;

  const threeDaysAgo = new Date(date + "T00:00:00");
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const pastEntries = await db.query.mealLogEntries.findMany({
    where: and(
      eq(schema.mealLogEntries.userId, userId),
      gte(schema.mealLogEntries.nutritionDate, threeDaysAgo.toISOString().slice(0, 10)),
    ),
    orderBy: [desc(schema.mealLogEntries.nutritionDate)],
  });

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
  const goalMode = onboarding?.goalMode ?? "";
  const goalModeLabel = GOAL_MODE_ES[goalMode] ?? goalMode;
  const goalAdvice = GOAL_MODE_ADVICE[goalMode] ?? "";
  const activityLevel = onboarding ? (ACTIVITY_ES[onboarding.activityLevel] ?? onboarding.activityLevel) : "?";
  const isTrainingDay = todayWorkouts.length > 0;
  const trainingNotes = todayWorkouts.map((w) => w.notes).filter(Boolean).join("; ");

  const SLOT_NAMES: Record<string, string> = {
    breakfast: "Desayuno", lunch: "Comida", dinner: "Cena", snack: "Snack", other: "Otro",
  };
  const registeredList = todayEntries.length > 0
    ? todayEntries
        .map((e) => `  - ${SLOT_NAMES[e.mealSlot] ?? e.mealSlot}: ${e.food?.name ?? e.foodName ?? "Alimento"} (${e.kcal} kcal, P:${Number(e.proteinG).toFixed(0)}g C:${Number(e.carbsG).toFixed(0)}g G:${Number(e.fatG).toFixed(0)}g)`)
        .join("\n")
    : "  Ninguna entrada registrada aún.";

  const weightInfo = onboarding ? `Peso: ${onboarding.weightKg}kg | Altura: ${onboarding.heightCm}cm | Edad: ${onboarding.ageYears}` : "";
  const neatInfo = onboarding?.neatFloorSteps ? `Objetivo NEAT (pasos): ${onboarding.neatFloorSteps}/día` : "";

  return `Eres el asesor nutricional personal de ${nickname} para hoy, ${date}.
Eres directo, amigable y práctico. Responde siempre en español.
Tu trabajo NO es solo registrar comidas: también asesora ACTIVAMENTE con cantidades concretas.

PERFIL:
  ${weightInfo}
  Nivel de actividad: ${activityLevel}
  ${neatInfo}

OBJETIVO: ${goalModeLabel}
  Calorías diana: ${kcalTarget} kcal${eatKcal > 0 ? ` (base ${target?.kcalTarget ?? "?"} + ${eatKcal} kcal entreno)` : ""}
  Proteína mín: ${target?.proteinMinG ?? "?"}g | Carbos: ${target?.carbsG ?? "?"}g | Grasas: ${target?.fatMinG ?? "?"}–${target?.fatMaxG ?? "?"}g
  ${isTrainingDay ? `HOY ES DÍA DE ENTRENO${trainingNotes ? `: ${trainingNotes}` : ""}` : "Hoy es día de descanso"}
  ${goalAdvice}

PROGRESO HOY (${date}):
  Consumido: ${consumed.kcal} kcal | P:${consumed.proteinG.toFixed(0)}g G:${consumed.fatG.toFixed(0)}g C:${consumed.carbsG.toFixed(0)}g
  Restante: ${remainingKcal} kcal | P:${Math.max(0, remainingProtein).toFixed(0)}g C:${Math.max(0, remainingCarbs).toFixed(0)}g G:${Math.max(0, remainingFatMin).toFixed(0)}–${Math.max(0, remainingFatMax).toFixed(0)}g

ENTRADAS YA REGISTRADAS HOY (NO las vuelvas a añadir aunque el usuario las mencione de nuevo):
${registeredList}

HISTORIAL ÚLTIMOS 3 DÍAS:
${historySummary}

INSTRUCCIONES:
- Cuando el usuario describa O MUESTRE (en imágenes) comidas, usa add_meal_entries() inmediatamente.
- Con imágenes: identifica TODOS los alimentos visibles y regístralos aunque el sistema indique que ya existen entradas similares.
- REGLA DE AGRUPADO: crea UNA entrada por alimento/plato diferente que se come por separado.
  - Si varios ingredientes se mezclan en una sola preparación (un batido, un café con leche, unas tostadas con mantequilla), es UNA entrada con los macros sumados.
  - Solo desglosa si los alimentos se toman por separado (ej. un bocadillo Y una fruta = 2 entradas).
- Estima porciones estándar si no se especifican.
- Usa el mealSlot correcto según el contexto (hora del día o lo que diga el usuario).

ASESORAMIENTO PROACTIVO (MUY IMPORTANTE):
- Cuando el usuario pregunte "¿cuánto como?", "¿qué me echo?", "¿cuánto arroz?" o similar, NUNCA le des rangos vagos.
- Calcula los macros restantes y dale GRAMOS CONCRETOS de cada alimento, redondeando a porciones prácticas (ej. "150g de arroz cocido", "200g de pechuga de pollo", "15g de aceite de oliva").
- Desglosa: "Para llegar a tu objetivo te faltan ~${remainingKcal} kcal. Te propongo: Xg de [alimento] (Y kcal, Pg Cg Gg) + Zg de [alimento] (...)"
- Si hoy es día de entreno y aún no ha comido la comida principal, sugiere más carbohidratos para rendimiento.
- Si es volumen y lleva poco consumo, adviértelo y sugiere comer más, especialmente carbos.
- Si es déficit y ya está cerca del techo, recomiende alimentos bajos en grasa y con buena saciedad.
- Si el usuario nombra un alimento concreto (ej. "pollo con arroz"), calcula los gramos exactos de CADA componente para cubrir los macros restantes, no le digas "entre 100 y 200g".
- Considera la hora: si entrena por la tarde, la comida del mediodía debe tener carbos suficientes; si ya entrenó, la cena debe recuperar.

ESTILO:
- Sé breve: 2-3 frases para confirmaciones, más detallado solo cuando asesores con gramos concretos.
- No repitas los valores numéricos que ya has registrado, solo confirma lo añadido con el nombre.
- La lista de "ENTRADAS YA REGISTRADAS" es solo orientativa para evitar duplicados obvios; si el usuario muestra imágenes nuevas, SIEMPRE registra lo que se ve.`;
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
          imageBase64: { type: "string", description: "Imagen en base64 (jpeg/png/webp) — compatibilidad hacia atrás" },
          imageMimeType: { type: "string" },
          images: {
            type: "array",
            description: "Array de imágenes en base64",
            items: {
              type: "object",
              properties: {
                imageBase64: { type: "string" },
                mimeType: { type: "string" },
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
    const { text, audioBase64, imageBase64, imageMimeType, images } = req.body as {
      text?: string;
      audioBase64?: string;
      imageBase64?: string;
      imageMimeType?: string;
      images?: Array<{ imageBase64: string; mimeType: string }>;
    };

    // Normalizar: si llega `images[]` usarlo, si llega `imageBase64` solo convertir a array
    const imageList: Array<{ imageBase64: string; mimeType: string }> =
      images && images.length > 0
        ? images
        : imageBase64
          ? [{ imageBase64, mimeType: imageMimeType ?? "image/jpeg" }]
          : [];

    if (!text && !audioBase64 && imageList.length === 0) {
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

    // Mensaje del usuario actual (puede incluir una o varias imágenes)
    if (imageList.length > 0) {
      // Si solo hay imágenes (sin texto), añadimos un prompt implícito para guiar al modelo
      const textContent = userText || "Analiza estos alimentos y regístralos en mi diario.";
      messages.push({
        role: "user",
        content: [
          { type: "text" as const, text: textContent },
          ...imageList.map((img) => ({
            type: "image_url" as const,
            image_url: { url: `data:${img.mimeType};base64,${img.imageBase64}`, detail: "low" as const },
          })),
        ],
      });
    } else {
      messages.push({ role: "user", content: userText });
    }

    // Cuando hay imágenes, forzamos el tool call: el usuario siempre quiere registrar lo que muestra
    const toolChoice: OpenAI.Chat.ChatCompletionToolChoiceOption =
      imageList.length > 0
        ? { type: "function", function: { name: "add_meal_entries" } }
        : "auto";

    // ── 4. Llamar al modelo ───────────────────────────────────────────────────
    let response: OpenAI.Chat.ChatCompletion;
    try {
      response = await openai.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages,
        tools,
        tool_choice: toolChoice,
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
        if (!("function" in toolCall)) continue;
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
