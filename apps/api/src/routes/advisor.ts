import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import OpenAI, { toFile } from "openai";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { env } from "../lib/env.js";

// ─── OpenAI client (solo para Whisper / transcripción de audio) ───────────────

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
    _openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return _openai;
}

// ─── Anthropic client (chat principal del asesor, con Claude Sonnet 4.5) ──────

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
    _anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
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

/**
 * Valida una propuesta de comida contra los macros restantes del día.
 * Calcula los macros reales de los alimentos con la FOOD_DB, los suma,
 * y compara con los objetivos restantes. Devuelve un texto con el veredicto
 * (OK o REFINE con ajustes sugeridos) que el modelo interpreta.
 */
function validateMealProposal(
  foods: Array<{ name: string; grams: number }>,
  remaining: { kcal: number; proteinG: number; carbsG: number; fatMinG: number; fatMaxG: number },
): string {
  if (!foods.length) {
    return "ERROR: No se han pasado alimentos. Llama a validate_meal con una lista de {name, grams}.";
  }

  const lines: string[] = [];
  const unknowns: string[] = [];
  let totalKcal = 0;
  let totalP = 0;
  let totalC = 0;
  let totalF = 0;

  for (const food of foods) {
    const found = findFood(food.name);
    if (!found) {
      unknowns.push(food.name);
      lines.push(`  - ${food.name} (${food.grams}g): ⚠ alimento no en la base de datos`);
      continue;
    }
    const factor = food.grams / 100;
    const kcal = found.entry.kcal * factor;
    const p = found.entry.proteinG * factor;
    const c = found.entry.carbsG * factor;
    const f = found.entry.fatG * factor;
    totalKcal += kcal;
    totalP += p;
    totalC += c;
    totalF += f;
    lines.push(
      `  - ${food.name} (${food.grams}g): ${Math.round(kcal)} kcal | P:${p.toFixed(1)}g C:${c.toFixed(1)}g G:${f.toFixed(1)}g`,
    );
  }

  // Desviaciones contra el objetivo RESTANTE del día
  const targetKcal = Math.max(0, remaining.kcal);
  const targetP = Math.max(0, remaining.proteinG);
  const targetC = Math.max(0, remaining.carbsG);
  const targetFMin = Math.max(0, remaining.fatMinG);
  const targetFMax = Math.max(0, remaining.fatMaxG);

  const devKcal = totalKcal - targetKcal;
  const devP = totalP - targetP;
  const devC = totalC - targetC;

  // Tolerancias (generosas para permitir redondeos y flexibilidad)
  const TOL_KCAL = 120;  // ±120 kcal
  const TOL_PROTEIN = 15; // ±15g
  const TOL_CARBS = 25;   // ±25g
  const FAT_OVER_LIMIT = 10; // gramos sobre el máximo permitido

  const issues: string[] = [];
  if (Math.abs(devKcal) > TOL_KCAL) {
    issues.push(`kcal ${devKcal > 0 ? "sobran" : "faltan"} ${Math.abs(Math.round(devKcal))}`);
  }
  if (targetP > 5 && Math.abs(devP) > TOL_PROTEIN) {
    issues.push(`proteína ${devP > 0 ? "sobran" : "faltan"} ${Math.abs(devP).toFixed(0)}g`);
  }
  if (targetC > 5 && Math.abs(devC) > TOL_CARBS) {
    issues.push(`carbos ${devC > 0 ? "sobran" : "faltan"} ${Math.abs(devC).toFixed(0)}g`);
  }
  if (totalF > targetFMax + FAT_OVER_LIMIT) {
    issues.push(`grasa ${(totalF - targetFMax).toFixed(0)}g por encima del máximo`);
  }
  if (totalF < targetFMin - FAT_OVER_LIMIT && targetFMin > 5) {
    issues.push(`grasa ${(targetFMin - totalF).toFixed(0)}g por debajo del mínimo`);
  }

  const verdict = issues.length === 0 ? "OK" : "REFINE";

  const header = `VEREDICTO: ${verdict}`;
  const breakdown = `DESGLOSE POR ALIMENTO:\n${lines.join("\n")}`;
  const totals = `TOTAL PROPUESTO: ${Math.round(totalKcal)} kcal | P:${totalP.toFixed(1)}g | C:${totalC.toFixed(1)}g | G:${totalF.toFixed(1)}g`;
  const objective = `OBJETIVO RESTANTE: ${targetKcal} kcal | P:${targetP.toFixed(0)}g | C:${targetC.toFixed(0)}g | G:${targetFMin.toFixed(0)}-${targetFMax.toFixed(0)}g`;
  const deviations = `DESVIACIÓN: kcal ${devKcal > 0 ? "+" : ""}${Math.round(devKcal)} | P ${devP > 0 ? "+" : ""}${devP.toFixed(0)}g | C ${devC > 0 ? "+" : ""}${devC.toFixed(0)}g | G ${totalF.toFixed(1)}g`;

  const footer = verdict === "OK"
    ? "La propuesta cierra los macros correctamente. Preséntala al usuario con este desglose."
    : `Ajusta la propuesta: ${issues.join("; ")}. Cambia gramos o alimentos y llama a validate_meal otra vez.`;

  const unknownsMsg = unknowns.length > 0
    ? `\n⚠ Alimentos no reconocidos en la base de datos: ${unknowns.join(", ")}. Los macros totales pueden ser imprecisos; sustitúyelos por alimentos similares reconocidos (ej. pasta cocida, arroz cocido, pechuga de pollo cocida, aceite de oliva, platano, manzana, queso fresco 0%, yogur griego 0%, leche semidesnatada, aguacate, lentejas cocidas, garbanzos cocidos).`
    : "";

  return [header, breakdown, totals, objective, deviations, footer + unknownsMsg].join("\n");
}

// ─── Tool definitions (formato Anthropic) ─────────────────────────────────────

const tools: Anthropic.Messages.Tool[] = [
  {
    name: "add_meal_entries",
    description:
      "Registra una o varias entradas de comida en el diario del usuario. " +
      "Llama a esta función siempre que el usuario describa o muestre (foto) algo que comió, " +
      "está comiendo o va a comer. Desglosa en entradas individuales (ej. bocadillo + café = 2 entradas).",
    input_schema: {
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
  {
    name: "validate_meal",
    description:
      "Valida una propuesta de comida contra los objetivos de macros restantes del día. " +
      "Úsala SIEMPRE ANTES de presentar al usuario una propuesta de comida con gramos concretos. " +
      "Pasa los alimentos con los gramos que propones y el backend calculará los macros reales " +
      "usando una base de datos nutricional precisa, comparará con los objetivos pendientes del día, " +
      "y te dirá si la propuesta cierra los macros (OK) o si necesitas ajustar (REFINE con detalles). " +
      "Si te responde REFINE, ajusta los gramos o cambia alimentos y llámala de nuevo. Máximo 3 intentos.",
    input_schema: {
      type: "object",
      required: ["foods"],
      properties: {
        foods: {
          type: "array",
          description: "Lista de alimentos propuestos para esta comida, con los gramos exactos que quieres proponer.",
          items: {
            type: "object",
            required: ["name", "grams"],
            properties: {
              name: { type: "string", description: "Nombre del alimento en español sencillo (ej. 'pasta cocida', 'pechuga de pollo cocida', 'aceite de oliva')." },
              grams: { type: "number", description: "Cantidad en gramos (redondeada a múltiplos de 5 o 10)." },
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
function buildSystemPrompt(state: DailyState, date: string): string {
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
   Pasa los alimentos con los gramos que propones y el backend te devolverá:
     - Los macros reales calculados contra una base de datos nutricional precisa.
     - Una desviación respecto al objetivo restante del día.
     - Un veredicto: OK (puedes presentar) o REFINE (ajusta y vuelve a validar).

────────────────────────────────────────────────
CÓMO PROPONER UNA COMIDA
────────────────────────────────────────────────
Cuando el usuario pida consejo sobre qué comer o cuánto comer:
1. Piensa alimentos coherentes (3-4 como mucho). No propongas grandes cantidades de un
   solo macro si ese objetivo ya está cubierto: si falta < 20g de proteína, NO añadas
   pollo/huevos/claras; usa solo carbos (pasta, arroz, pan, patata, fruta) y un poco de grasa.
2. Asigna gramos a cada alimento con tu intuición (ballpark).
3. Llama validate_meal para que el backend calcule los macros reales.
4. Si te dice REFINE con desviaciones grandes, ajusta los gramos (o cambia un alimento)
   y llama a validate_meal de nuevo. Máximo 3 intentos.
5. Cuando tengas OK, presenta la propuesta al usuario con desglose por alimento y el
   total vs objetivo restante, en formato markdown.

Si el usuario te propone una cantidad distinta a la que sugeriste, NO digas solo "perfecto".
Evalúa si encaja con su objetivo del día; si se pasa o se queda corto, adviértelo y sugiere
cómo compensar en la siguiente comida.

────────────────────────────────────────────────
ESTILO
────────────────────────────────────────────────
- Breve: 2-3 frases para confirmaciones, más detallado cuando asesores con gramos concretos.
- Usa markdown: **negrita** para énfasis, - para listas.
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
    const anthropic = getAnthropic();
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
    const state = await computeDailyState(userId, date);
    const systemPrompt = buildSystemPrompt(state, date);

    // ── 3. Construir mensajes iniciales (formato Anthropic) ───────────────────
    const messages: Anthropic.Messages.MessageParam[] = history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Mensaje del usuario actual: texto + imágenes si las hay
    const userContent: Anthropic.Messages.ContentBlockParam[] = [];
    const textPart = userText || (imageList.length > 0 ? "Analiza estos alimentos y regístralos en mi diario." : "");
    if (textPart) userContent.push({ type: "text", text: textPart });
    for (const img of imageList) {
      const mediaType = (img.mimeType === "image/png" || img.mimeType === "image/gif" || img.mimeType === "image/webp")
        ? img.mimeType
        : "image/jpeg";
      userContent.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data: img.imageBase64 },
      });
    }
    messages.push({ role: "user", content: userContent });

    // ── 4. Agentic loop: llamar al modelo hasta que no haya más tool uses ─────
    const addedEntries: Array<{
      id: string; name: string; mealSlot: string; quantityG: number;
      kcal: number; proteinG: number; fatG: number; carbsG: number;
    }> = [];

    let finalText = "";
    const MAX_ITERATIONS = 6;

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      let response: Anthropic.Messages.Message;
      try {
        response = await anthropic.messages.create({
          model: env.ANTHROPIC_MODEL,
          max_tokens: 2048,
          system: systemPrompt,
          messages,
          tools,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        app.log.error({ err }, "Anthropic chat error");
        return reply.status(502).send({ error: `Error al contactar con el modelo de IA: ${msg}` });
      }

      const toolUses = response.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
      const textBlocks = response.content.filter((b): b is Anthropic.Messages.TextBlock => b.type === "text");

      // Si no hay tool uses, es la respuesta final
      if (toolUses.length === 0 || response.stop_reason === "end_turn") {
        finalText = textBlocks.map((t) => t.text).join("\n").trim();
        if (finalText || toolUses.length === 0) break;
      }

      // Añadir el turno del asistente
      messages.push({ role: "assistant", content: response.content });

      // Procesar cada tool use y construir los tool_results
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

      for (const tu of toolUses) {
        if (tu.name === "add_meal_entries") {
          const args = tu.input as {
            entries: Array<{
              name: string; mealSlot: string; quantityG: number;
              kcal: number; proteinG: number; fatG: number; carbsG: number;
            }>;
          };
          const insertedNames: string[] = [];
          for (const entry of args.entries ?? []) {
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
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: insertedNames.length > 0
              ? `Entradas registradas correctamente: ${insertedNames.join(", ")}`
              : "No se registró ninguna entrada (array vacío).",
          });
          continue;
        }

        if (tu.name === "validate_meal") {
          const args = tu.input as { foods: Array<{ name: string; grams: number }> };
          const result = validateMealProposal(args.foods ?? [], state.remaining);
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: result,
          });
          continue;
        }

        // Tool desconocida — devolver error
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: `Tool desconocida: ${tu.name}`,
          is_error: true,
        });
      }

      messages.push({ role: "user", content: toolResults });
    }

    // Fallback si no hubo respuesta textual
    if (!finalText) {
      finalText = addedEntries.length > 0
        ? `Registrado: ${addedEntries.map((e) => e.name).join(", ")}.`
        : "No he podido generar una respuesta. Prueba a reformular la pregunta.";
    }

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
