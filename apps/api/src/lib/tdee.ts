/**
 * Lógica de cálculo nutricional.
 *
 * Referencias:
 *  - Mifflin-St Jeor (1990) para BMR
 *  - Factores de actividad de Ainsworth et al.
 *  - Rangos de proteína de la ISSN (2017)
 */

export type Sex = "m" | "f" | "other";

export type ActivityLevel =
  | "sedentary"         // trabajo de escritorio, sin ejercicio
  | "lightly_active"    // ejercicio ligero 1-3 días/semana
  | "moderately_active" // ejercicio moderado 3-5 días/semana
  | "very_active"       // ejercicio intenso 6-7 días/semana
  | "extra_active";     // atleta / trabajo físico muy intenso

export type GoalMode =
  | "volumen_limpio"
  | "mantenimiento"
  | "definicion"
  | "recomposicion"
  | "perdida_peso";

// ─── Constantes ──────────────────────────────────────────────────────────────

const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  lightly_active: 1.375,
  moderately_active: 1.55,
  very_active: 1.725,
  extra_active: 1.9,
};

/**
 * Delta calórico aplicado al TDEE según objetivo.
 * Basado en guías de composición corporal:
 *  - Volumen limpio: +300 kcal (superávit moderado, ~0.25 kg/semana)
 *  - Mantenimiento: 0
 *  - Definición: -400 kcal (déficit moderado, preserva músculo)
 *  - Recomposición: 0 (mismas kcal, distinta distribución de macros)
 *  - Pérdida de peso: -600 kcal (déficit agresivo pero sostenible)
 */
const GOAL_KCAL_DELTA: Record<GoalMode, number> = {
  volumen_limpio: 300,
  mantenimiento: 0,
  definicion: -400,
  recomposicion: 0,
  perdida_peso: -600,
};

/**
 * Proteína objetivo en g/kg de peso corporal según objetivo.
 * Rangos superiores en fases de déficit para preservar masa muscular.
 */
const PROTEIN_G_PER_KG: Record<GoalMode, number> = {
  volumen_limpio: 2.2,
  mantenimiento: 2.0,
  definicion: 2.4,
  recomposicion: 2.3,
  perdida_peso: 2.2,
};

/**
 * Tolerancia kcal para marcar el día como "verde" en la UI.
 * Mantenimiento y recomposición son más estrictos (±5 %).
 */
const KCAL_GREEN_PCT: Record<GoalMode, number> = {
  volumen_limpio: 7,
  mantenimiento: 5,
  definicion: 7,
  recomposicion: 5,
  perdida_peso: 7,
};

/**
 * Objetivo NEAT sugerido (pasos/día) según nivel de actividad declarado.
 * Los usuarios sedentarios necesitan el empuje mayor.
 */
const NEAT_SUGGESTED_STEPS: Record<ActivityLevel, number> = {
  sedentary: 8000,
  lightly_active: 7000,
  moderately_active: 6000,
  very_active: 5000,
  extra_active: 5000,
};

// ─── Funciones ───────────────────────────────────────────────────────────────

/**
 * BMR con Mifflin-St Jeor.
 * Para "other" se usa la media de ambas fórmulas.
 */
function calcBmr(weightKg: number, heightCm: number, ageYears: number, sex: Sex): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  if (sex === "m") return base + 5;
  if (sex === "f") return base - 161;
  return base + (5 - 161) / 2; // promedio para "other"
}

export interface TdeeInput {
  weightKg: number;
  heightCm: number;
  ageYears: number;
  sex: Sex;
  activityLevel: ActivityLevel;
  goalMode: GoalMode;
}

export interface TdeeResult {
  bmr: number;
  tdee: number;
  kcalTarget: number;
  proteinMinG: number;
  fatMinG: number;
  fatMaxG: number;
  carbsG: number;
  kcalGreenPct: number;
  neatSuggestedSteps: number;
}

/**
 * Calcula el TDEE y distribuye los macros según objetivo.
 *
 * Distribución de grasas:
 *  - Mínimo: 20 % de kcalTarget (salud hormonal)
 *  - Máximo: 35 % de kcalTarget
 *  - Diana: 25 % (punto de equilibrio saludable)
 *
 * Carbohidratos: resto de calorías tras proteína y grasa diana.
 * En volumen limpio se prioriza que el superávit vaya a hidratos,
 * lo que ocurre de forma natural porque la proteína y la grasa
 * se calculan sobre el peso (no sobre kcal adicionales).
 */
export function calcTdee(input: TdeeInput): TdeeResult {
  const { weightKg, heightCm, ageYears, sex, activityLevel, goalMode } = input;

  const bmr = Math.round(calcBmr(weightKg, heightCm, ageYears, sex));
  const tdee = Math.round(bmr * ACTIVITY_FACTOR[activityLevel]);
  const kcalTarget = Math.max(1200, tdee + GOAL_KCAL_DELTA[goalMode]);

  // Proteína
  const proteinMinG = Math.round(weightKg * PROTEIN_G_PER_KG[goalMode]);
  const proteinKcal = proteinMinG * 4;

  // Grasas
  const fatMinG = Math.round((kcalTarget * 0.20) / 9);
  const fatMaxG = Math.round((kcalTarget * 0.35) / 9);
  const fatTargetG = Math.round((kcalTarget * 0.25) / 9);
  const fatKcal = fatTargetG * 9;

  // Carbohidratos (resto)
  const carbsKcal = Math.max(0, kcalTarget - proteinKcal - fatKcal);
  const carbsG = Math.round(carbsKcal / 4);

  return {
    bmr,
    tdee,
    kcalTarget,
    proteinMinG,
    fatMinG,
    fatMaxG,
    carbsG,
    kcalGreenPct: KCAL_GREEN_PCT[goalMode],
    neatSuggestedSteps: NEAT_SUGGESTED_STEPS[activityLevel],
  };
}
