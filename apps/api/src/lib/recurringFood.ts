/**
 * Favoritos recurrentes: referencia normalizada (por defecto 100 g) y escalado al registrar.
 */

export const RECURRING_REFERENCE_GRAMS = 100;

export type MealLike = {
  kcal: number;
  quantityG: string | number;
  proteinG: string | number;
  fatG: string | number;
  carbsG: string | number;
};

/** Convierte una entrada registrada (cualquier cantidad en g) a macros por referenceGrams (típicamente 100). */
export function normalizeEntryToReferenceGrams(entry: MealLike, referenceGrams = RECURRING_REFERENCE_GRAMS): {
  quantityG: string;
  kcalPerServing: number;
  proteinG: string;
  fatG: string;
  carbsG: string;
} {
  const qty = Number(entry.quantityG);
  const ref = referenceGrams > 0 ? referenceGrams : RECURRING_REFERENCE_GRAMS;
  if (!qty || qty <= 0 || !Number.isFinite(qty)) {
    const kcal = Math.round(entry.kcal);
    return {
      quantityG: String(ref),
      kcalPerServing: kcal,
      proteinG: fmtG(entry.proteinG),
      fatG: fmtG(entry.fatG),
      carbsG: fmtG(entry.carbsG),
    };
  }

  const factor = ref / qty;
  return {
    quantityG: String(ref),
    kcalPerServing: Math.round(entry.kcal * factor),
    proteinG: fmtG(Number(entry.proteinG) * factor),
    fatG: fmtG(Number(entry.fatG) * factor),
    carbsG: fmtG(Number(entry.carbsG) * factor),
  };
}

export type RecurringRow = {
  quantityG: string | number;
  kcalPerServing: number;
  proteinG: string | number;
  fatG: string | number;
  carbsG: string | number;
};

/** Escala los macros guardados (para la cantidad `recurring.quantityG`) a `requestedGrams`. */
export function scaleRecurringToLoggedQuantity(recurring: RecurringRow, requestedGrams: number): {
  quantityG: string;
  kcal: number;
  proteinG: string;
  fatG: string;
  carbsG: string;
} {
  const refQty = Number(recurring.quantityG);
  if (!refQty || refQty <= 0 || !Number.isFinite(requestedGrams) || requestedGrams <= 0) {
    throw new Error("invalid_quantity");
  }
  const scale = requestedGrams / refQty;
  return {
    quantityG: requestedGrams.toFixed(1),
    kcal: Math.round(recurring.kcalPerServing * scale),
    proteinG: fmtG(Number(recurring.proteinG) * scale),
    fatG: fmtG(Number(recurring.fatG) * scale),
    carbsG: fmtG(Number(recurring.carbsG) * scale),
  };
}

function fmtG(n: number | string): string {
  return Number(n).toFixed(1);
}
