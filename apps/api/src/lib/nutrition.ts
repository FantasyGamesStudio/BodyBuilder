/**
 * Cálculos nutricionales para el registro de comidas.
 */

export interface FoodMacros {
  kcalPer100g: number;
  proteinPer100g: number;
  fatPer100g: number;
  carbsPer100g: number;
}

export interface ComputedMacros {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

/**
 * Calcula los macros de una porción dados los valores por 100 g del alimento.
 * Los resultados se redondean a 1 decimal excepto kcal (entero).
 */
export function computeMacros(food: FoodMacros, quantityG: number): ComputedMacros {
  const factor = quantityG / 100;
  return {
    kcal: Math.round(food.kcalPer100g * factor),
    proteinG: round1(food.proteinPer100g * factor),
    fatG: round1(food.fatPer100g * factor),
    carbsG: round1(food.carbsPer100g * factor),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─── Resumen diario ───────────────────────────────────────────────────────────

export interface DayTotals {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

export interface DayProgress {
  totals: DayTotals;
  /** Porcentaje respecto al objetivo (0-100+) */
  kcalPct: number;
  proteinPct: number;
  fatPct: number;
  carbsPct: number;
  /** green = en objetivo · yellow = cerca del rango · red = fuera de rango */
  kcalStatus: "green" | "yellow" | "red";
}

export interface DayTarget {
  kcalTarget: number;
  proteinMinG: number;
  fatMinG: number;
  fatMaxG: number;
  carbsG: number;
  kcalGreenPct: number;
}

/**
 * Agrega una lista de entradas y calcula el progreso del día contra el target.
 */
export function computeDayProgress(
  entries: ComputedMacros[],
  target: DayTarget,
): DayProgress {
  const totals = entries.reduce<DayTotals>(
    (acc, e) => ({
      kcal: acc.kcal + e.kcal,
      proteinG: round1(acc.proteinG + e.proteinG),
      fatG: round1(acc.fatG + e.fatG),
      carbsG: round1(acc.carbsG + e.carbsG),
    }),
    { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 },
  );

  const margin = Math.round(target.kcalTarget * target.kcalGreenPct / 100);
  const low = target.kcalTarget - margin;
  const high = target.kcalTarget + margin;

  let kcalStatus: DayProgress["kcalStatus"];
  if (totals.kcal >= low && totals.kcal <= high) {
    kcalStatus = "green";
  } else if (totals.kcal < low * 0.85 || totals.kcal > high * 1.15) {
    kcalStatus = "red";
  } else {
    kcalStatus = "yellow";
  }

  return {
    totals,
    kcalPct: target.kcalTarget > 0 ? Math.round((totals.kcal / target.kcalTarget) * 100) : 0,
    proteinPct: target.proteinMinG > 0 ? Math.round((totals.proteinG / target.proteinMinG) * 100) : 0,
    fatPct: target.fatMaxG > 0 ? Math.round((totals.fatG / target.fatMaxG) * 100) : 0,
    carbsPct: target.carbsG > 0 ? Math.round((totals.carbsG / target.carbsG) * 100) : 0,
    kcalStatus,
  };
}
