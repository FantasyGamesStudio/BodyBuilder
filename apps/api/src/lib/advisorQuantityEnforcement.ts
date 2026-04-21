/**
 * Detección de cuándo el asesor debe haber pasado por validate_meal
 * antes de dar cifras concretas al usuario (gramos, totales de comida).
 */

function normalizeUserText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** El texto del usuario sugiere consejo con cantidades / macros / cerrar el día. */
export function userWantsQuantifiedMealAdvice(userText: string): boolean {
  const t = normalizeUserText(userText);
  if (t.length < 3) return false;

  const strongMarkers = [
    "macro",
    "calor",
    "kcal",
    "gramo",
    "cerrar",
    "objetivo",
    "restante",
    "cuanto",
    "porcion",
    "propuesta",
    "valida",
    "desglose",
    "quedar",
    "deficit",
    "opcion",
    "nutricion",
    "carbonara",
  ];
  if (strongMarkers.some((m) => t.includes(m))) return true;

  const mealCue = ["cena", "almuerzo", "desayuno", "snack"].some((m) => t.includes(m));
  const mealQuestion = ["que como", "qué como", "que ceno", "qué ceno", "que desayuno", "qué desayuno"].some((m) =>
    t.includes(m),
  );
  return mealCue && mealQuestion;
}

/**
 * La respuesta del asistente incluye cantidades que deberían venir de validate_meal
 * (gramos, totales de comida con kcal, tablas tipo P:/C:).
 */
export function assistantResponseHasConcreteQuantities(assistantText: string): boolean {
  const text = assistantText.trim();
  if (!text) return false;

  if (/\d+\s*g\b/i.test(text)) return true;
  if (/\d+\s*(kcal|cal)\b/i.test(text)) return true;
  if (/\|\s*P\s*:\s*\d/i.test(text)) return true;
  if (/total[^\n]{0,40}\d+\s*kcal/i.test(text)) return true;
  if (/cena propuesta|total cena|total del d[ií]a/i.test(text) && /\d+\s*kcal/i.test(text)) return true;

  return false;
}

/** Resultado textual devuelto por validateMealProposal en la tool. */
export function isValidateMealOkResult(toolContent: string): boolean {
  return /^VEREDICTO:\s*OK\b/m.test(toolContent.trim());
}

export const MEAL_QUANTITIES_NUDGE_MESSAGE =
  "[Instrucción del sistema] Has respondido con gramos, calorías o totales de macros, " +
  "pero en esta petición no obtuviste VEREDICTO: OK desde la herramienta validate_meal. " +
  "No inventes ni redondees totales a mano: llama validate_meal con cada alimento y los gramos exactos " +
  "que recomiendas; si devuelve REFINE, ajusta gramos o alimentos y vuelve a llamar hasta OK (máximo 3 intentos). " +
  "En la respuesta final, los números de kcal y P/C/G deben coincidir exactamente con el bloque DESGLOSE/TOTAL PROPUESTO del último OK.";
