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

// ─── Base de datos nutricional de referencia (por 100g salvo indicación) ──────

type FoodEntry = { kcal: number; proteinG: number; carbsG: number; fatG: number };

const FOOD_DB: Record<string, FoodEntry> = {
  "pasta cocida":             { kcal: 131, proteinG: 4.5,  carbsG: 26.0, fatG: 0.9 },
  "arroz cocido":             { kcal: 130, proteinG: 2.7,  carbsG: 28.2, fatG: 0.3 },
  "pan de molde blanco":      { kcal: 265, proteinG: 8.0,  carbsG: 50.0, fatG: 3.5 },
  "pan baguette":             { kcal: 270, proteinG: 9.0,  carbsG: 52.0, fatG: 2.5 },
  "pan integral":             { kcal: 247, proteinG: 9.0,  carbsG: 45.0, fatG: 3.5 },
  "patata cocida":            { kcal:  77, proteinG: 2.0,  carbsG: 17.0, fatG: 0.1 },
  "patata al horno":          { kcal:  93, proteinG: 2.5,  carbsG: 21.0, fatG: 0.1 },
  "avena cruda":              { kcal: 370, proteinG: 13.0, carbsG: 59.0, fatG: 7.0 },
  "platano":                  { kcal:  89, proteinG: 1.1,  carbsG: 23.0, fatG: 0.3 },
  "manzana":                  { kcal:  52, proteinG: 0.3,  carbsG: 14.0, fatG: 0.2 },
  "naranja":                  { kcal:  47, proteinG: 0.9,  carbsG: 12.0, fatG: 0.1 },
  "uvas":                     { kcal:  69, proteinG: 0.7,  carbsG: 18.0, fatG: 0.2 },
  "mango":                    { kcal:  60, proteinG: 0.8,  carbsG: 15.0, fatG: 0.4 },
  "pera":                     { kcal:  57, proteinG: 0.4,  carbsG: 15.0, fatG: 0.1 },
  "pechuga de pollo cocida":  { kcal: 165, proteinG: 31.0, carbsG:  0.0, fatG: 3.6 },
  "pechuga de pavo cocida":   { kcal: 135, proteinG: 29.0, carbsG:  0.0, fatG: 1.7 },
  "lomo de cerdo cocido":     { kcal: 175, proteinG: 26.0, carbsG:  0.0, fatG: 7.0 },
  "salmon cocinado":          { kcal: 208, proteinG: 25.0, carbsG:  0.0, fatG: 12.0 },
  "atun en agua escurrido":   { kcal: 116, proteinG: 26.0, carbsG:  0.0, fatG: 0.8 },
  "huevo entero":             { kcal: 143, proteinG: 12.5, carbsG:  1.0, fatG: 10.0 },
  "clara de huevo":           { kcal:  52, proteinG: 10.9, carbsG:  0.7, fatG: 0.2 },
  "queso fresco 0%":          { kcal:  63, proteinG: 11.0, carbsG:  3.5, fatG: 0.2 },
  "yogur griego 0%":          { kcal:  57, proteinG: 9.0,  carbsG:  4.0, fatG: 0.3 },
  "leche semidesnatada":      { kcal:  46, proteinG: 3.3,  carbsG:  5.0, fatG: 1.5 },
  "aceite de oliva":          { kcal: 884, proteinG: 0.0,  carbsG:  0.0, fatG: 100.0 },
  "mantequilla":              { kcal: 717, proteinG: 0.9,  carbsG:  0.1, fatG: 81.0 },
  "almendras":                { kcal: 579, proteinG: 21.0, carbsG: 10.0, fatG: 50.0 },
  "aguacate":                 { kcal: 160, proteinG: 2.0,  carbsG:  2.0, fatG: 15.0 },
  "lentejas cocidas":         { kcal: 116, proteinG: 9.0,  carbsG: 20.0, fatG: 0.4 },
  "garbanzos cocidos":        { kcal: 164, proteinG: 9.0,  carbsG: 27.0, fatG: 2.6 },
  "brocoli cocido":           { kcal:  35, proteinG: 2.4,  carbsG:  5.1, fatG: 0.4 },
  "espinacas cocidas":        { kcal:  23, proteinG: 3.0,  carbsG:  1.4, fatG: 0.4 },
  "zanahoria cruda":          { kcal:  41, proteinG: 0.9,  carbsG:  9.6, fatG: 0.2 },
  "tomate crudo":             { kcal:  18, proteinG: 0.9,  carbsG:  3.9, fatG: 0.2 },
  "lechuga":                  { kcal:  15, proteinG: 1.4,  carbsG:  2.2, fatG: 0.2 },
};

/** Busca el alimento más parecido en FOOD_DB por similitud de nombre (lowercase, sin tildes). */
function normalizeFoodName(name: string): string {
  return name.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

function findFood(name: string): { key: string; entry: FoodEntry } | null {
  const normalized = normalizeFoodName(name);
  // Búsqueda exacta primero
  for (const [key, entry] of Object.entries(FOOD_DB)) {
    if (normalizeFoodName(key) === normalized) return { key, entry };
  }
  // Búsqueda por contención
  for (const [key, entry] of Object.entries(FOOD_DB)) {
    const nk = normalizeFoodName(key);
    if (normalized.includes(nk) || nk.includes(normalized)) return { key, entry };
  }
  return null;
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
  {
    type: "function",
    function: {
      name: "calculate_meal_portions",
      description:
        "Calcula matemáticamente los gramos exactos de cada alimento necesarios para alcanzar " +
        "los objetivos de macros del usuario. Llama a esta función SIEMPRE que el usuario pida " +
        "consejo sobre qué comer o cuánto comer para cerrar el día. NO intentes calcular los gramos " +
        "tú mismo: usa esta función para obtener los cálculos precisos y luego presenta el resultado al usuario.",
      parameters: {
        type: "object",
        required: ["foods", "targetProteinG", "targetCarbsG", "targetFatMinG", "targetKcal"],
        properties: {
          foods: {
            type: "array",
            description: "Lista de alimentos que quieres incluir en la propuesta de comida.",
            items: {
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string", description: "Nombre del alimento (ej. 'pasta cocida', 'pechuga de pollo cocida')" },
                fixedG: { type: "number", description: "Si el usuario indicó una cantidad fija, ponla aquí. Si no, omite este campo y el sistema calculará los gramos óptimos." },
              },
            },
          },
          targetProteinG: { type: "number", description: "Gramos de proteína que deben cubrirse con esta comida." },
          targetCarbsG: { type: "number", description: "Gramos de carbohidratos que deben cubrirse con esta comida." },
          targetFatMinG: { type: "number", description: "Gramos mínimos de grasa que deben cubrirse con esta comida." },
          targetKcal: { type: "number", description: "Calorías totales que deben cubrirse con esta comida." },
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
  const doneWorkouts = todayWorkouts.filter((w) => w.status === "done" || !w.status);
  const plannedWorkouts = todayWorkouts.filter((w) => w.status === "planned");
  const eatKcal = doneWorkouts.reduce((s, w) => s + w.kcalBurned, 0);
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
  const isTrainingDay = doneWorkouts.length > 0 || plannedWorkouts.length > 0;
  const doneWorkoutNotes = doneWorkouts.map((w) => w.notes).filter(Boolean).join("; ");

  // Hora actual (usada para razonar sobre timing pre/post-entreno)
  const nowHour = new Date().getHours();
  const nowMinute = new Date().getMinutes();
  const currentTimeStr = `${String(nowHour).padStart(2, "0")}:${String(nowMinute).padStart(2, "0")}`;

  // Calcular timing relativo al entreno planificado
  const plannedWorkoutInfo = plannedWorkouts.map((w) => {
    const time = w.plannedAt ? ` a las ${w.plannedAt}` : "";
    const note = w.notes ? ` (${w.notes})` : "";
    let timingAdvice = "";
    if (w.plannedAt) {
      const [wHour, wMin] = w.plannedAt.split(":").map(Number);
      const workoutMinutes = (wHour ?? 0) * 60 + (wMin ?? 0);
      const nowMinutes = nowHour * 60 + nowMinute;
      const diffMinutes = workoutMinutes - nowMinutes;
      if (diffMinutes > 0 && diffMinutes <= 120) {
        timingAdvice = ` ⚠️ FALTAN ~${Math.round(diffMinutes)} MIN PARA EL ENTRENO: prioriza carbohidratos de absorción media-rápida en la próxima comida`;
      } else if (diffMinutes > 120 && diffMinutes <= 240) {
        timingAdvice = ` (faltan ~${Math.round(diffMinutes / 60)}h: la próxima comida debe incluir carbos suficientes para llegar con energía)`;
      } else if (diffMinutes < 0) {
        timingAdvice = ` (ya debería haber empezado o terminado)`;
      }
    }
    return `planificado${time}${note}${timingAdvice}`;
  }).join("; ");

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

  return `Eres el asesor nutricional personal de ${nickname} para hoy, ${date}. Son las ${currentTimeStr}.
Eres directo, amigable y práctico. Responde siempre en español.

════════════════════════════════════════════════════════════
MISIÓN PRINCIPAL — LEE ESTO PRIMERO
════════════════════════════════════════════════════════════
Cuando el usuario pida consejo sobre qué comer o cuánto comer, debes llamar OBLIGATORIAMENTE
a la función calculate_meal_portions. NUNCA calcules los gramos tú mismo: el backend tiene
una base de datos nutricional precisa y hará los cálculos matemáticamente correctos.

OBJETIVOS ACTUALES DE ESTA COMIDA:
  Calorías restantes: ${remainingKcal} kcal
  Proteína restante:  ${Math.max(0, remainingProtein).toFixed(0)}g
  Carbos restantes:   ${Math.max(0, remainingCarbs).toFixed(0)}g
  Grasa restante:     ${Math.max(0, remainingFatMin).toFixed(0)}–${Math.max(0, remainingFatMax).toFixed(0)}g

CÓMO USAR calculate_meal_portions:
  1. Decide qué alimentos quieres proponer (máximo 3-4 para no complicar la comida).
  2. Pasa como "foods" la lista de alimentos, con los nombres en español simple
     (ej. "pasta cocida", "pechuga de pollo cocida", "arroz cocido", "platano").
  3. Pasa los valores de targetProteinG, targetCarbsG, targetFatMinG y targetKcal
     directamente desde los OBJETIVOS ACTUALES de arriba.
  4. El backend calculará los gramos exactos y te devolverá el resultado.
  5. Presenta el resultado al usuario con el desglose por alimento y el total vs objetivo.

SELECCIÓN DE ALIMENTOS — regla de prioridad:
  - Si proteína restante < 20g: elige alimentos BAJOS en proteína (pasta, arroz, pan,
    patata, fruta) para cubrir los carbos sin pasarte de proteína.
  - Si proteína restante ≥ 20g: puedes incluir una fuente proteica + fuentes de carbos.
  - Si el usuario nombra alimentos concretos, úsalos. Si no, elige tú según la prioridad.

Si el usuario pregunta por un alimento concreto (ej. "¿cuánto arroz?"), llama a
calculate_meal_portions con solo ese alimento y los objetivos actuales.
════════════════════════════════════════════════════════════

PERFIL:
  ${weightInfo}
  Nivel de actividad: ${activityLevel}
  ${neatInfo}

OBJETIVO: ${goalModeLabel}
  Calorías diana: ${kcalTarget} kcal${eatKcal > 0 ? ` (base ${target?.kcalTarget ?? "?"} + ${eatKcal} kcal entreno)` : ""}
  Proteína mín: ${target?.proteinMinG ?? "?"}g | Carbos: ${target?.carbsG ?? "?"}g | Grasas: ${target?.fatMinG ?? "?"}–${target?.fatMaxG ?? "?"}g
  ${doneWorkouts.length > 0 ? `ENTRENO YA REALIZADO${doneWorkoutNotes ? `: ${doneWorkoutNotes}` : ""}` : ""}
  ${plannedWorkouts.length > 0 ? `ENTRENO PLANIFICADO: ${plannedWorkoutInfo}` : ""}
  ${!isTrainingDay ? "Hoy es día de descanso" : ""}
  ${goalAdvice}

PROGRESO HOY (${date}) — ESTOS SON LOS DATOS REALES, ÚSALOS SIEMPRE:
  Consumido: ${consumed.kcal} kcal | P:${consumed.proteinG.toFixed(0)}g G:${consumed.fatG.toFixed(0)}g C:${consumed.carbsG.toFixed(0)}g
  ▶ RESTANTE: ${remainingKcal} kcal | P:${Math.max(0, remainingProtein).toFixed(0)}g C:${Math.max(0, remainingCarbs).toFixed(0)}g G:${Math.max(0, remainingFatMin).toFixed(0)}–${Math.max(0, remainingFatMax).toFixed(0)}g
  (Estos son los macros que deben cubrirse con las comidas que quedan hoy)

ENTRADAS YA REGISTRADAS HOY (NO las vuelvas a añadir aunque el usuario las mencione de nuevo):
${registeredList}

HISTORIAL ÚLTIMOS 3 DÍAS:
${historySummary}

INSTRUCCIONES DE REGISTRO:
- Cuando el usuario describa O MUESTRE (en imágenes) comidas, usa add_meal_entries() inmediatamente.
- Con imágenes: identifica TODOS los alimentos visibles y regístralos aunque el sistema indique que ya existen entradas similares.
- REGLA DE AGRUPADO: crea UNA entrada por alimento/plato diferente que se come por separado.
  - Si varios ingredientes se mezclan en una sola preparación (un batido, un café con leche, unas tostadas con mantequilla), es UNA entrada con los macros sumados.
  - Solo desglosa si los alimentos se toman por separado (ej. un bocadillo Y una fruta = 2 entradas).
- Estima porciones estándar si no se especifican.
- Usa el mealSlot correcto según el contexto (hora del día o lo que diga el usuario).

TIMING Y ENTRENO:
- Son las ${currentTimeStr}. Úsalo para razonar sobre el timing de las comidas respecto al entreno.
- Si hay entreno planificado y faltan menos de 2h: la próxima comida DEBE ser rica en carbohidratos de absorción media-rápida (arroz, pasta, pan, fruta) y baja en grasa/fibra para digestión rápida.
- Si hay entreno planificado y faltan 2-4h: incluir carbos suficientes en la próxima comida para tener energía en el entreno.
- Si el entreno ya se realizó: la siguiente comida debe priorizar proteína + carbos para recuperación muscular.
- Si hoy es día de descanso: distribuye los macros de forma equilibrada sin necesidad de timing específico.

ASESORAMIENTO ADICIONAL:
- Cuando el usuario te diga que se echó una cantidad DISTINTA a la que le sugeriste, NO le digas simplemente "vale, perfecto". Evalúa si esa cantidad encaja con su objetivo del día. Si se pasa, adviértelo amablemente y sugiere compensar en la siguiente comida. Si se queda corto, sugiere añadir algo para llegar al objetivo.
- Revisa el historial de los últimos 3 días ANTES de aconsejar. Si ha tenido días altos en grasa, sugiere opciones más magras hoy.
- Si el usuario lleva varios días con un patrón (ej. siempre le falta proteína en el desayuno), menciónalo proactivamente.
- Sé firme: si el objetivo de grasa es 60-70g y ya lleva 65g, dile "ya estás en el límite de grasa, mejor evita añadir más".
- Si es volumen y lleva poco consumo, adviértelo y sugiere comer más, especialmente carbos.
- Si es déficit y ya está cerca del techo, recomienda alimentos bajos en grasa y con buena saciedad.

ESTILO:
- Sé breve: 2-3 frases para confirmaciones, más detallado solo cuando asesores con gramos concretos.
- No repitas los valores numéricos que ya has registrado, solo confirma lo añadido con el nombre.
- La lista de "ENTRADAS YA REGISTRADAS" es solo orientativa para evitar duplicados obvios; si el usuario muestra imágenes nuevas, SIEMPRE registra lo que se ve.
- Usa formato markdown en tus respuestas: **negrita** para énfasis, - para listas.`;
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

    // ── 5. Ejecutar tool calls ────────────────────────────────────────────────
    if (assistantMessage.tool_calls?.length) {
      const toolResults: OpenAI.Chat.ChatCompletionMessageParam[] = [assistantMessage];

      for (const toolCall of assistantMessage.tool_calls) {
        if (!("function" in toolCall)) continue;

        // ── 5a. calculate_meal_portions: cálculo matemático en el backend ──────
        if (toolCall.function.name === "calculate_meal_portions") {
          const args = JSON.parse(toolCall.function.arguments) as {
            foods: Array<{ name: string; fixedG?: number }>;
            targetProteinG: number;
            targetCarbsG: number;
            targetFatMinG: number;
            targetKcal: number;
          };

          // Resolver qué alimentos están en la BD y cuáles no
          const resolved = args.foods.map((f) => ({
            name: f.name,
            fixedG: f.fixedG,
            dbEntry: findFood(f.name),
          }));

          // Alimentos con cantidad fija: calcular sus macros y restar del objetivo
          let remainP = args.targetProteinG;
          let remainC = args.targetCarbsG;
          let remainF = args.targetFatMinG;
          let remainKcal = args.targetKcal;

          const resultLines: string[] = [];

          for (const item of resolved) {
            if (item.fixedG !== undefined && item.dbEntry) {
              const factor = item.fixedG / 100;
              const p = item.dbEntry.entry.proteinG * factor;
              const c = item.dbEntry.entry.carbsG * factor;
              const f = item.dbEntry.entry.fatG * factor;
              const k = item.dbEntry.entry.kcal * factor;
              remainP -= p;
              remainC -= c;
              remainF -= f;
              remainKcal -= k;
              resultLines.push(
                `${item.name}: ${item.fixedG}g → ${Math.round(k)} kcal | P:${p.toFixed(1)}g C:${c.toFixed(1)}g G:${f.toFixed(1)}g (cantidad fija)`
              );
            }
          }

          // Alimentos sin cantidad fija: distribuir los macros restantes
          // Estrategia: primero cubrir carbos con fuentes ricas en carbos, luego proteína, luego grasa
          const freeItems = resolved.filter((i) => i.fixedG === undefined && i.dbEntry);
          const unknownItems = resolved.filter((i) => !i.dbEntry);

          // Ordenar: los más ricos en carbos primero, luego proteína, luego grasa
          freeItems.sort((a, b) => {
            const carbRatioA = (a.dbEntry!.entry.carbsG / (a.dbEntry!.entry.kcal || 1));
            const carbRatioB = (b.dbEntry!.entry.carbsG / (b.dbEntry!.entry.kcal || 1));
            return carbRatioB - carbRatioA;
          });

          // Asignar gramos a cada alimento libre usando los macros restantes
          for (let i = 0; i < freeItems.length; i++) {
            const item = freeItems[i];
            if (!item.dbEntry) continue;
            const e = item.dbEntry.entry;

            let grams = 0;

            if (i < freeItems.length - 1) {
              // Para todos menos el último: asignar proporcional a su capacidad de cubrir carbos
              // Si tiene carbos significativos, usarlo para cubrir carbos restantes
              if (e.carbsG > 5 && remainC > 0) {
                grams = Math.round((remainC / freeItems.length) / (e.carbsG / 100));
              } else if (e.proteinG > 10 && remainP > 0) {
                grams = Math.round(remainP / (e.proteinG / 100));
              } else if (e.fatG > 5 && remainF > 0) {
                grams = Math.round(remainF / (e.fatG / 100));
              } else {
                grams = Math.round(remainKcal / freeItems.length / (e.kcal / 100));
              }
            } else {
              // Para el último alimento: cubrir exactamente las kcal restantes
              grams = remainKcal > 0 ? Math.max(0, Math.round(remainKcal / (e.kcal / 100))) : 0;
            }

            // Redondear a múltiplos de 10g para mayor practicidad
            grams = Math.round(grams / 10) * 10;
            grams = Math.max(0, grams);

            const factor = grams / 100;
            const p = e.proteinG * factor;
            const c = e.carbsG * factor;
            const f = e.fatG * factor;
            const k = e.kcal * factor;
            remainP -= p;
            remainC -= c;
            remainF -= f;
            remainKcal -= k;

            resultLines.push(
              `${item.name}: ${grams}g → ${Math.round(k)} kcal | P:${p.toFixed(1)}g C:${c.toFixed(1)}g G:${f.toFixed(1)}g`
            );
          }

          for (const item of unknownItems) {
            resultLines.push(`${item.name}: alimento no encontrado en la base de datos, estima tú los gramos`);
          }

          // Recalcular totales reales para el resumen
          const totalP = args.targetProteinG - remainP;
          const totalC = args.targetCarbsG - remainC;
          const totalF = args.targetFatMinG - remainF;
          const totalKcal = args.targetKcal - remainKcal;

          const summary = [
            "RESULTADO DEL CÁLCULO DE PORCIONES:",
            ...resultLines,
            `TOTAL PROPUESTA: ${Math.round(totalKcal)} kcal | P:${totalP.toFixed(1)}g | C:${totalC.toFixed(1)}g | G:${totalF.toFixed(1)}g`,
            `OBJETIVO ERA:    ${args.targetKcal} kcal | P:${args.targetProteinG}g | C:${args.targetCarbsG}g | G:≥${args.targetFatMinG}g`,
            `DESVIACIÓN:      ${Math.round(totalKcal - args.targetKcal)} kcal | P:${(totalP - args.targetProteinG).toFixed(1)}g | C:${(totalC - args.targetCarbsG).toFixed(1)}g`,
            "Presenta estos resultados al usuario con el desglose por alimento y el resumen total vs objetivo.",
          ].join("\n");

          toolResults.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: summary,
          });

          continue;
        }

        // ── 5b. add_meal_entries: registrar comidas ───────────────────────────
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
          max_tokens: 1024,
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
