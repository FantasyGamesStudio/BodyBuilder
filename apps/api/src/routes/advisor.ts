import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import OpenAI, { toFile } from "openai";
import type { ChatCompletionAssistantMessageParam, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import {
  assistantResponseHasConcreteQuantities,
  isValidateMealOkResult,
  MEAL_QUANTITIES_NUDGE_MESSAGE,
  userWantsQuantifiedMealAdvice,
} from "../lib/advisorQuantityEnforcement.js";
import { validateMealProposal } from "../lib/advisorFoodDb.js";
import { ADVISOR_CHAT_TOOLS } from "../lib/advisorOpenAiTools.js";
import { toneGuardAdvisorReply } from "../lib/advisorToneGuard.js";
import { env } from "../lib/env.js";
import { normalizeEntryToReferenceGrams, scaleRecurringToLoggedQuantity } from "../lib/recurringFood.js";

// ─── OpenAI client (Whisper + chat del asesor con tools) ───────────────────────

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
    _openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return _openai;
}

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
    "redondeando a porciones prácticas (ej. 90g arroz blanco crudo / seco, no 87g). " +
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

/** Estado nutricional computado para un usuario y fecha. */
type DailyState = {
  nickname: string;
  goalModeLabel: string;
  weightKg?: number;
  heightCm?: number;
  ageYears?: number;
  activityLevel: string;
  kcalTarget: number;
  proteinMinG: number;
  carbsTargetG: number;
  fatMinG: number;
  fatMaxG: number;
  consumed: { kcal: number; proteinG: number; carbsG: number; fatG: number };
  remaining: { kcal: number; proteinG: number; carbsG: number; fatMinG: number; fatMaxG: number };
  todayEntries: Array<{ mealSlot: string; name: string; kcal: number; proteinG: number; carbsG: number; fatG: number }>;
  doneWorkoutsText: string;
  plannedWorkoutsText: string;
  isTrainingDay: boolean;
  isRestDay: boolean;
  historySummary: string;
  currentTimeStr: string;
  workoutTimingHint: string;
};

/** Calcula el estado nutricional del día de forma reutilizable (para prompt y para validate_meal). */
async function computeDailyState(userId: string, date: string): Promise<DailyState> {
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

  const todayEntriesRaw = await db.query.mealLogEntries.findMany({
    where: and(eq(schema.mealLogEntries.userId, userId), eq(schema.mealLogEntries.nutritionDate, date)),
    with: { food: true },
  });
  const todayWorkouts = await db.query.workoutLogs.findMany({
    where: and(eq(schema.workoutLogs.userId, userId), eq(schema.workoutLogs.workoutDate, date)),
  });

  const consumed = todayEntriesRaw.reduce(
    (acc, e) => ({
      kcal: acc.kcal + e.kcal,
      proteinG: acc.proteinG + Number(e.proteinG),
      carbsG: acc.carbsG + Number(e.carbsG),
      fatG: acc.fatG + Number(e.fatG),
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );

  const doneWorkouts = todayWorkouts.filter((w) => w.status === "done" || !w.status);
  const plannedWorkouts = todayWorkouts.filter((w) => w.status === "planned");
  const eatKcal = doneWorkouts.reduce((s, w) => s + w.kcalBurned, 0);
  const kcalTarget = (target?.kcalTarget ?? 2000) + eatKcal;

  const remaining = {
    kcal: kcalTarget - consumed.kcal,
    proteinG: (target?.proteinMinG ?? 0) - consumed.proteinG,
    carbsG: (target?.carbsG ?? 0) - consumed.carbsG,
    fatMinG: (target?.fatMinG ?? 0) - consumed.fatG,
    fatMaxG: (target?.fatMaxG ?? 0) - consumed.fatG,
  };

  // Historial de los últimos 3 días
  const threeDaysAgo = new Date(date + "T00:00:00");
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const pastEntries = await db.query.mealLogEntries.findMany({
    where: and(
      eq(schema.mealLogEntries.userId, userId),
      gte(schema.mealLogEntries.nutritionDate, threeDaysAgo.toISOString().slice(0, 10)),
    ),
    orderBy: [desc(schema.mealLogEntries.nutritionDate)],
  });
  const byDay: Record<string, { kcal: number; proteinG: number; carbsG: number; fatG: number }> = {};
  for (const e of pastEntries) {
    if (e.nutritionDate === date) continue;
    byDay[e.nutritionDate] ??= { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
    byDay[e.nutritionDate].kcal += e.kcal;
    byDay[e.nutritionDate].proteinG += Number(e.proteinG);
    byDay[e.nutritionDate].carbsG += Number(e.carbsG);
    byDay[e.nutritionDate].fatG += Number(e.fatG);
  }
  const historySummary = Object.entries(byDay)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([d, v]) =>
      `  ${d}: ${v.kcal} kcal | P:${v.proteinG.toFixed(0)}g C:${v.carbsG.toFixed(0)}g G:${v.fatG.toFixed(0)}g`,
    )
    .join("\n") || "  Sin datos anteriores";

  // Hora actual y timing vs entreno planificado
  const nowHour = new Date().getHours();
  const nowMinute = new Date().getMinutes();
  const currentTimeStr = `${String(nowHour).padStart(2, "0")}:${String(nowMinute).padStart(2, "0")}`;

  let workoutTimingHint = "";
  for (const w of plannedWorkouts) {
    if (!w.plannedAt) continue;
    const [wHour, wMin] = w.plannedAt.split(":").map(Number);
    const diff = ((wHour ?? 0) * 60 + (wMin ?? 0)) - (nowHour * 60 + nowMinute);
    if (diff > 0 && diff <= 120) {
      workoutTimingHint = `Faltan ~${diff}min para el entreno — prioriza carbos de absorción media-rápida en la próxima comida.`;
    } else if (diff > 120 && diff <= 240) {
      workoutTimingHint = `Faltan ~${Math.round(diff / 60)}h para el entreno — próxima comida debe incluir carbos suficientes.`;
    }
    break;
  }
  if (!workoutTimingHint && doneWorkouts.length > 0) {
    workoutTimingHint = "Entreno ya realizado — prioriza proteína + carbos para recuperación.";
  }

  const SLOT_NAMES: Record<string, string> = { breakfast: "Desayuno", lunch: "Comida", dinner: "Cena", snack: "Snack", other: "Otro" };
  const todayEntries = todayEntriesRaw.map((e) => ({
    mealSlot: SLOT_NAMES[e.mealSlot] ?? e.mealSlot,
    name: e.food?.name ?? e.foodName ?? "Alimento",
    kcal: e.kcal,
    proteinG: Number(e.proteinG),
    carbsG: Number(e.carbsG),
    fatG: Number(e.fatG),
  }));

  const doneWorkoutsText = doneWorkouts.map((w) => w.notes).filter(Boolean).join("; ");
  const plannedWorkoutsText = plannedWorkouts.map((w) => {
    const time = w.plannedAt ? ` a las ${w.plannedAt}` : "";
    const note = w.notes ? ` (${w.notes})` : "";
    return `${time}${note}`.trim();
  }).join("; ");

  return {
    nickname: profile?.nickname ?? "Usuario",
    goalModeLabel: GOAL_MODE_ES[onboarding?.goalMode ?? ""] ?? (onboarding?.goalMode ?? "—"),
    weightKg: onboarding?.weightKg ? Number(onboarding.weightKg) : undefined,
    heightCm: onboarding?.heightCm ?? undefined,
    ageYears: onboarding?.ageYears ?? undefined,
    activityLevel: onboarding ? (ACTIVITY_ES[onboarding.activityLevel] ?? onboarding.activityLevel) : "—",
    kcalTarget,
    proteinMinG: target?.proteinMinG ?? 0,
    carbsTargetG: target?.carbsG ?? 0,
    fatMinG: target?.fatMinG ?? 0,
    fatMaxG: target?.fatMaxG ?? 0,
    consumed,
    remaining,
    todayEntries,
    doneWorkoutsText,
    plannedWorkoutsText,
    isTrainingDay: doneWorkouts.length > 0 || plannedWorkouts.length > 0,
    isRestDay: doneWorkouts.length === 0 && plannedWorkouts.length === 0,
    historySummary,
    currentTimeStr,
    workoutTimingHint,
  };
}

/** System prompt simplificado. El modelo decide qué comer, validate_meal valida los números. */
function buildSystemPrompt(state: DailyState, date: string, advisorModelId: string): string {
  const r = state.remaining;
  const entriesList = state.todayEntries.length > 0
    ? state.todayEntries.map((e) => `  - ${e.mealSlot}: ${e.name} (${e.kcal} kcal)`).join("\n")
    : "  Ninguna todavía.";

  const workoutLine = state.doneWorkoutsText
    ? `Entreno hecho: ${state.doneWorkoutsText}`
    : state.plannedWorkoutsText
      ? `Entreno planificado${state.plannedWorkoutsText}`
      : "Hoy es día de descanso";

  return `Eres el asesor nutricional personal de ${state.nickname}. Hoy es ${date}, son las ${state.currentTimeStr}.
Responde siempre en español, de forma directa, amigable y práctica.

PERFIL DEL USUARIO
  Peso ${state.weightKg ?? "?"}kg · Altura ${state.heightCm ?? "?"}cm · Edad ${state.ageYears ?? "?"}
  Actividad: ${state.activityLevel}
  Objetivo: ${state.goalModeLabel}
  ${workoutLine}${state.workoutTimingHint ? `\n  ${state.workoutTimingHint}` : ""}

OBJETIVO DIARIO
  Calorías: ${state.kcalTarget} kcal
  Proteína mín: ${state.proteinMinG}g · Carbos: ${state.carbsTargetG}g · Grasa: ${state.fatMinG}-${state.fatMaxG}g

CONSUMIDO HOY
  ${state.consumed.kcal} kcal | P:${state.consumed.proteinG.toFixed(0)}g C:${state.consumed.carbsG.toFixed(0)}g G:${state.consumed.fatG.toFixed(0)}g

▶ RESTANTE (cubre esto con las comidas que queden hoy)
  ${r.kcal} kcal | P:${Math.max(0, r.proteinG).toFixed(0)}g C:${Math.max(0, r.carbsG).toFixed(0)}g G:${Math.max(0, r.fatMinG).toFixed(0)}-${Math.max(0, r.fatMaxG).toFixed(0)}g

────────────────────────────────────────────────
DATOS DEL SERVIDOR (no contradecir ni pedirlos de nuevo al usuario)
────────────────────────────────────────────────
- Modelo OpenAI usado en esta petición: **${advisorModelId}**. Si preguntan qué LLM o modelo de IA eres,
  di que eres el asesor de BodyBuilder y que esta conversación usa el modelo **${advisorModelId}** vía API OpenAI.
  No respondas solo "GPT-4" ni otra familia genérica si no coincide con lo anterior.
- OBJETIVO DIARIO, CONSUMIDO HOY y RESTANTE están ya calculados arriba desde la base de datos actual.
  NO pidas al usuario que te dicte cuántas kcal o cuántos gramos de proteína/carbohidratos/grasa le faltan para el día.
  Usa exclusivamente los números de este mensaje para asesorar.
  Si el usuario dice que ha cambiado objetivos, los valores de esta conversación ya incorporan el conjunto activo
  en el servidor en el momento de esta petición; no pidas que "los confirme por chat" salvo discrepancia evidente.

────────────────────────────────────────────────
GRAMAJE: PASTA Y ARROZ EN SECO (prioridad para cocinar en casa)
────────────────────────────────────────────────
- Para comidas que el usuario va a cocinar aún: propón **gramos SECOS** de pasta de trigo y arroz blanco (fácil de pesar antes de hervir).
- En validate_meal usa claves exactas con gramos secos: **pasta seca cruda**, **arroz blanco crudo**.
- Para sobras o platos ya terminados usa **pasta cocida**, **arroz cocido** con gramos cocidos.
- En el texto al usuario indica explícito **(seco)** o **gramos antes de cocinar** junto a pasta/arroz cuando propongas hacerlos.

────────────────────────────────────────────────
RESTANTE DE PROTEÍNA YA CUBIERTO (~0 g o muy bajo)
────────────────────────────────────────────────
- Si RESTANTE de proteína es 0 g o casi y la propuesta lleva huevo/queso/carne, no califiques el día como “cierre perfecto/excelente”
  sin explicar el **trade-off** (vas a sumar proteína respecto al objetivo mínimo del día).
- Usa los números del validate_meal: di aproximadamente cuántos gramos de proteína **extra** supone esa comida.
- No trivialices un exceso grande (p. ej. +20–30 g) como “por el huevo es poco”; en ese caso ofrece reducir porción o asumir el exceso con claridad.

ENTRADAS YA REGISTRADAS HOY
${entriesList}

HISTORIAL ÚLTIMOS 3 DÍAS
${state.historySummary}

────────────────────────────────────────────────
TUS DOS HERRAMIENTAS
────────────────────────────────────────────────
1. add_meal_entries: úsala cuando el usuario DESCRIBA o MUESTRE (foto) algo que comió,
   come ahora o va a comer. Registra cada alimento diferente que se toma por separado.

2. validate_meal: úsala SIEMPRE antes de responder con una propuesta de gramos concretos.
   Para pasta/arroz crudos a cocinar usa nombres **pasta seca cruda** y **arroz blanco crudo** (gramos SECOS).
   El backend devolverá macros según la base de datos, desviación vs RESTANTE y OK o REFINE.

────────────────────────────────────────────────
SI NOMBRA UN PLATO O RECETA (prioridad sobre “optimizar números” en silencio)
────────────────────────────────────────────────
Si el usuario dice un plato concreto (ej. carbonara, tortilla de patatas, ensalada césar):
- NO lo sustituyas por otro estilo distinto (ej. aglio e olio, pasta solo con aceite) sin
  explicarlo y sin ofrecer antes el conflicto con RESTANTE.
- En 1–2 frases explica el choque cuando aplique (ej. carbonara lleva huevo y queso → más
  proteína cuando P ya está cubierta o sobraba poco margen).
- Ofrece opciones claras, por ejemplo:
  · la misma receta con cantidades más pequeñas para limitar proteína en exceso;
  · la misma receta en porción normal y aceptar llevar proteína por encima ese día (dilo explícito);
  · una variante del plato solo si el usuario da margen o preguntas “¿te vale…?”.
- No inventes combinaciones solo para cerrar macros (ej. pasta + aceite + plátano como “cena tipo X”)
  si el usuario pidió otra cosa: mejor carbos coherentes con el plato (más pasta seca cruda, pan con el plato)
  o preguntas antes si puede añadir algo extra fuera del plato.
- Si nombró solo el plato principal y **no** pidió postre o fruta aparte, **no añadas** postre/fruta solo
  para cerrar carbos salvo que **preguntes antes** (“¿Te añado fruta?”) o puedas cerrar carbos con **más
  pasta seca cruda** u otro componente del propio plato.
Cuando solo pida “cerrar el día” o “qué ceno” sin nombrar plato, sí puedes proponer lo que mejor
 encaje en RESTANTE usando la FOOD_DB.

────────────────────────────────────────────────
CÓMO PROPONER UNA COMIDA
────────────────────────────────────────────────
Cuando el usuario pida consejo sobre qué comer o cuánto comer:
1. Si NO ha pedido un plato concreto: piensa alimentos coherentes (3-4 como mucho). Si un macro
   ya está cubierto en RESTANTE, evita seguir cargando ese macro salvo para cuadrar algo mínimo:
   ej. si falta poca proteína no añadas grandes dosis de pollo/huevo; usa carbos/grasa según falte.
   Si SÍ nombró un plato concreto, sigue las reglas de la sección anterior antes que esta regla genérica.
2. Asigna gramos (ballpark): pasta y arroz **a cocinar** → **pasta seca cruda** y **arroz blanco crudo**
   con gramos secos; sobras o ya cocidos → pasta cocida / arroz cocido con gramos cocidos.
3. Llama validate_meal para que el backend calcule los macros reales.
4. Si te dice REFINE con desviaciones grandes, ajusta los gramos (o cambia un alimento)
   y llama a validate_meal de nuevo. Máximo 3 intentos.
5. Cuando tengas OK, presenta la propuesta al usuario con desglose por alimento y el
   total vs objetivo restante, en formato markdown.
   Copia los números EXACTAMENTE del resultado de validate_meal (DESGLOSE y TOTAL PROPUESTO);
   no recalcules kcal ni macros mentalmente.

Si el usuario te propone una cantidad distinta a la que sugeriste, NO digas solo "perfecto".
Evalúa si encaja con su objetivo del día; si se pasa o se queda corto, adviértelo y sugiere
cómo compensar en la siguiente comida.

────────────────────────────────────────────────
ESTILO
────────────────────────────────────────────────
- Breve: 2-3 frases para confirmaciones, más detallado cuando asesores con gramos concretos.
- Markdown (obligatorio para que el cliente lo renderice bien):
  · Encabezados # ## ### solo en su propia línea; deja una línea en blanco antes del encabezado.
  · No pongas ### dentro de una viñeta (mal: "• ### Desglose"); bien: línea con "### Desglose" y luego la lista.
  · Listas con guión y espacio: "- ítem". No uses la viñeta • salvo que sea texto dentro de un párrafo.
  · **negrita** para énfasis.
- Fruta fresca (plátano, manzana, pera…): indica siempre gramos del desglose Y una cantidad orientativa
  en unidades (ej. "plátano (~170 g, ≈1 mediano)" o "2 medianos ~240 g"). No des solo gramos sin referencia.
- Confirmaciones: solo di el alimento, no repitas los macros que acabas de registrar.`;
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

    return reply.send({
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    });
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

    // ── 1. Transcribir audio con Whisper (OpenAI) si se envió ─────────────────
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

    // ── 2. Cargar historial y estado nutricional ──────────────────────────────
    const history = await db.query.advisorMessages.findMany({
      where: and(
        eq(schema.advisorMessages.userId, userId),
        eq(schema.advisorMessages.conversationDate, date),
      ),
      orderBy: (m, { asc }) => [asc(m.createdAt)],
    });
    let state = await computeDailyState(userId, date);
    let systemPrompt = buildSystemPrompt(state, date, env.OPENAI_ADVISOR_MODEL);

    // ── 3. Construir thread (OpenAI Chat Completions) ──────────────────────────
    const thread: ChatCompletionMessageParam[] = history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const textPart = userText || (imageList.length > 0 ? "Analiza estos alimentos y regístralos en mi diario." : "");
    if (imageList.length === 0) {
      thread.push({ role: "user", content: textPart });
    } else {
      thread.push({
        role: "user",
        content: [
          { type: "text", text: textPart },
          ...imageList.map((img) => {
            const mime =
              img.mimeType === "image/png" || img.mimeType === "image/gif" || img.mimeType === "image/webp"
                ? img.mimeType
                : "image/jpeg";
            return {
              type: "image_url" as const,
              image_url: { url: `data:${mime};base64,${img.imageBase64}` },
            };
          }),
        ],
      });
    }

    // ── 4. Agentic loop: chat + tool calls ───────────────────────────────────
    const addedEntries: Array<{
      id: string; name: string; mealSlot: string; quantityG: number;
      kcal: number; proteinG: number; fatG: number; carbsG: number;
    }> = [];

    let finalText = "";
    let validateMealOkThisRequest = false;
    const MAX_ITERATIONS = 10;

    const parseToolArgs = (raw: string): Record<string, unknown> => {
      try {
        return JSON.parse(raw || "{}") as Record<string, unknown>;
      } catch {
        return {};
      }
    };

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      let completion;
      try {
        completion = await openai.chat.completions.create({
          model: env.OPENAI_ADVISOR_MODEL,
          messages: [{ role: "system", content: systemPrompt }, ...thread],
          tools: ADVISOR_CHAT_TOOLS,
          tool_choice: "auto",
          max_completion_tokens: 2048,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        app.log.error({ err }, "OpenAI advisor chat error");
        return reply.status(502).send({ error: `Error al contactar con el modelo de IA: ${msg}` });
      }

      const msg = completion.choices[0]?.message;
      if (!msg) {
        return reply.status(502).send({ error: "Respuesta vacía del modelo de IA" });
      }

      const toolCalls = msg.tool_calls;

      if (!toolCalls?.length) {
        finalText = (msg.content ?? "").trim();

        const mustRetryValidate =
          userWantsQuantifiedMealAdvice(userText) &&
          assistantResponseHasConcreteQuantities(finalText) &&
          !validateMealOkThisRequest;

        if (mustRetryValidate && iteration < MAX_ITERATIONS - 1) {
          const assistantRetry: ChatCompletionAssistantMessageParam = {
            role: "assistant",
            content: msg.content ?? "",
          };
          thread.push(assistantRetry);
          thread.push({ role: "user", content: MEAL_QUANTITIES_NUDGE_MESSAGE });
          continue;
        }

        if (mustRetryValidate && iteration >= MAX_ITERATIONS - 1) {
          finalText +=
            "\n\n_(Nota: las cantidades de esta respuesta no pasaron por validación automática contra la base nutricional; comprueba los números.)_";
        }

        break;
      }

      const assistantToolMsg: ChatCompletionAssistantMessageParam = {
        role: "assistant",
        content: msg.content,
        tool_calls: msg.tool_calls,
      };
      thread.push(assistantToolMsg);

      for (const tc of toolCalls) {
        if (tc.type !== "function") continue;
        const fn = tc.function;
        const args = parseToolArgs(fn.arguments ?? "");

        if (fn.name === "add_meal_entries") {
          const entries = args.entries as
            | Array<{
                name: string;
                mealSlot: string;
                quantityG: number;
                kcal: number;
                proteinG: number;
                fatG: number;
                carbsG: number;
              }>
            | undefined;
          const insertedNames: string[] = [];
          for (const entry of entries ?? []) {
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
            insertedNames.push(`${entry.name} (${SLOT_ES[entry.mealSlot] ?? entry.mealSlot}, ${Math.round(entry.kcal)} kcal)`);
          }
          thread.push({
            role: "tool",
            tool_call_id: tc.id,
            content:
              insertedNames.length > 0
                ? `Entradas registradas correctamente: ${insertedNames.join(", ")}`
                : "No se registró ninguna entrada (array vacío).",
          });
          state = await computeDailyState(userId, date);
          systemPrompt = buildSystemPrompt(state, date, env.OPENAI_ADVISOR_MODEL);
          continue;
        }

        if (fn.name === "validate_meal") {
          const foods = args.foods as Array<{ name: string; grams: number }> | undefined;
          const result = validateMealProposal(foods ?? [], state.remaining);
          if (isValidateMealOkResult(result)) validateMealOkThisRequest = true;
          thread.push({
            role: "tool",
            tool_call_id: tc.id,
            content: result,
          });
          continue;
        }

        thread.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `Tool desconocida: ${fn.name}`,
        });
      }
    }

    // Fallback si no hubo respuesta textual
    if (!finalText) {
      finalText = addedEntries.length > 0
        ? `Registrado: ${addedEntries.map((e) => e.name).join(", ")}.`
        : "No he podido generar una respuesta. Prueba a reformular la pregunta.";
    }

    finalText = toneGuardAdvisorReply(finalText, state.remaining.proteinG);

    // ── 5. Guardar mensajes en BD ─────────────────────────────────────────────
    await db.insert(schema.advisorMessages).values([
      { userId, conversationDate: date, role: "user", content: userText || (imageList.length > 0 ? "[imagen]" : "") },
      { userId, conversationDate: date, role: "assistant", content: finalText },
    ]);

    return reply.send({
      reply: finalText,
      addedEntries,
      transcription: audioBase64 ? userText : undefined,
    });
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

    const norm = normalizeEntryToReferenceGrams(entry);

    if (existing) {
      await db.update(schema.recurringFoods)
        .set({
          timesUsed: existing.timesUsed + 1,
          lastUsedAt: new Date(),
          mealSlot: entry.mealSlot,
          kcalPerServing: norm.kcalPerServing,
          proteinG: norm.proteinG,
          fatG: norm.fatG,
          carbsG: norm.carbsG,
          quantityG: norm.quantityG,
        })
        .where(eq(schema.recurringFoods.id, existing.id));
      return reply.status(201).send({ id: existing.id });
    }

    const [created] = await db.insert(schema.recurringFoods).values({
      userId,
      name,
      kcalPerServing: norm.kcalPerServing,
      proteinG: norm.proteinG,
      fatG: norm.fatG,
      carbsG: norm.carbsG,
      quantityG: norm.quantityG,
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
          /** Gramos a registrar; si no se envía, se usa la cantidad de referencia del favorito (p. ej. 100). */
          quantityG: { type: "number" },
        },
      },
      response: { 201: { type: "object", properties: { id: { type: "string" } } } },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const userId = req.user.sub;
    const { id } = req.params as { id: string };
    const { nutritionDate, mealSlot, quantityG: bodyQty } = req.body as {
      nutritionDate: string;
      mealSlot?: string;
      quantityG?: number;
    };

    const recurring = await db.query.recurringFoods.findFirst({
      where: and(eq(schema.recurringFoods.id, id), eq(schema.recurringFoods.userId, userId)),
    });
    if (!recurring) return reply.status(404).send({ error: "not_found" });

    const requestedG =
      bodyQty !== undefined && bodyQty !== null && Number.isFinite(bodyQty)
        ? bodyQty
        : Number(recurring.quantityG);

    let scaled;
    try {
      scaled = scaleRecurringToLoggedQuantity(recurring, requestedG);
    } catch {
      return reply.status(400).send({ error: "invalid_quantity" });
    }

    const [entry] = await db.insert(schema.mealLogEntries).values({
      userId,
      foodId: null,
      foodName: recurring.name,
      nutritionDate,
      mealSlot: mealSlot ?? recurring.mealSlot,
      quantityG: scaled.quantityG,
      kcal: scaled.kcal,
      proteinG: scaled.proteinG,
      fatG: scaled.fatG,
      carbsG: scaled.carbsG,
    }).returning({ id: schema.mealLogEntries.id });

    await db.update(schema.recurringFoods)
      .set({ timesUsed: recurring.timesUsed + 1, lastUsedAt: new Date() })
      .where(eq(schema.recurringFoods.id, id));

    return reply.status(201).send({ id: entry.id });
  });
};
