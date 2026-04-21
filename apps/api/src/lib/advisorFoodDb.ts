/**
 * Base nutricional de referencia del asesor (por 100 g salvo líquidos ≈ ml).
 * Valores orientativos tipo tabla genérica (no marca concreta).
 */

export type FoodEntry = { kcal: number; proteinG: number; carbsG: number; fatG: number };

export const FOOD_DB: Record<string, FoodEntry> = {
  /** Gramos SECOS antes de cocinar — preferido para propuestas y cocina en casa */
  "pasta seca cruda": {
    kcal: 371,
    proteinG: 13.0,
    carbsG: 74.0,
    fatG: 1.5,
  },
  /** Gramos SECOS antes de cocinar — arroz blanco largo típico */
  "arroz blanco crudo": {
    kcal: 365,
    proteinG: 7.1,
    carbsG: 80.0,
    fatG: 0.7,
  },

  "pasta cocida": { kcal: 131, proteinG: 4.5, carbsG: 26.0, fatG: 0.9 },
  "arroz cocido": { kcal: 130, proteinG: 2.7, carbsG: 28.2, fatG: 0.3 },
  "pan de molde blanco": { kcal: 265, proteinG: 8.0, carbsG: 50.0, fatG: 3.5 },
  "pan baguette": { kcal: 270, proteinG: 9.0, carbsG: 52.0, fatG: 2.5 },
  "pan integral": { kcal: 247, proteinG: 9.0, carbsG: 45.0, fatG: 3.5 },
  "patata cocida": { kcal: 77, proteinG: 2.0, carbsG: 17.0, fatG: 0.1 },
  "patata al horno": { kcal: 93, proteinG: 2.5, carbsG: 21.0, fatG: 0.1 },
  "avena cruda": { kcal: 370, proteinG: 13.0, carbsG: 59.0, fatG: 7.0 },
  "platano": { kcal: 89, proteinG: 1.1, carbsG: 23.0, fatG: 0.3 },
  "manzana": { kcal: 52, proteinG: 0.3, carbsG: 14.0, fatG: 0.2 },
  "naranja": { kcal: 47, proteinG: 0.9, carbsG: 12.0, fatG: 0.1 },
  "uvas": { kcal: 69, proteinG: 0.7, carbsG: 18.0, fatG: 0.2 },
  "mango": { kcal: 60, proteinG: 0.8, carbsG: 15.0, fatG: 0.4 },
  "pera": { kcal: 57, proteinG: 0.4, carbsG: 15.0, fatG: 0.1 },
  "pechuga de pollo cocida": { kcal: 165, proteinG: 31.0, carbsG: 0.0, fatG: 3.6 },
  "pechuga de pavo cocida": { kcal: 135, proteinG: 29.0, carbsG: 0.0, fatG: 1.7 },
  "lomo de cerdo cocido": { kcal: 175, proteinG: 26.0, carbsG: 0.0, fatG: 7.0 },
  "salmon cocinado": { kcal: 208, proteinG: 25.0, carbsG: 0.0, fatG: 12.0 },
  "atun en agua escurrido": { kcal: 116, proteinG: 26.0, carbsG: 0.0, fatG: 0.8 },
  "huevo entero": { kcal: 143, proteinG: 12.5, carbsG: 1.0, fatG: 10.0 },
  "clara de huevo": { kcal: 52, proteinG: 10.9, carbsG: 0.7, fatG: 0.2 },
  "queso fresco 0%": { kcal: 63, proteinG: 11.0, carbsG: 3.5, fatG: 0.2 },
  /** ~tipo ricotta batida (aprox.) */
  "queso fresco batido": { kcal: 138, proteinG: 11.2, carbsG: 6.5, fatG: 10.4 },
  "yogur griego 0%": { kcal: 57, proteinG: 9.0, carbsG: 4.0, fatG: 0.3 },
  "leche semidesnatada": { kcal: 46, proteinG: 3.3, carbsG: 5.0, fatG: 1.5 },
  "leche entera": { kcal: 64, proteinG: 3.4, carbsG: 4.9, fatG: 3.7 },
  "aceite de oliva": { kcal: 884, proteinG: 0.0, carbsG: 0.0, fatG: 100.0 },
  "mantequilla": { kcal: 717, proteinG: 0.9, carbsG: 0.1, fatG: 81.0 },
  "almendras": { kcal: 579, proteinG: 21.0, carbsG: 10.0, fatG: 50.0 },
  "aguacate": { kcal: 160, proteinG: 2.0, carbsG: 2.0, fatG: 15.0 },
  "lentejas cocidas": { kcal: 116, proteinG: 9.0, carbsG: 20.0, fatG: 0.4 },
  "garbanzos cocidos": { kcal: 164, proteinG: 9.0, carbsG: 27.0, fatG: 2.6 },
  "brocoli cocido": { kcal: 35, proteinG: 2.4, carbsG: 5.1, fatG: 0.4 },
  "espinacas cocidas": { kcal: 23, proteinG: 3.0, carbsG: 1.4, fatG: 0.4 },
  "zanahoria cruda": { kcal: 41, proteinG: 0.9, carbsG: 9.6, fatG: 0.2 },
  "tomate crudo": { kcal: 18, proteinG: 0.9, carbsG: 3.9, fatG: 0.2 },
  "lechuga": { kcal: 15, proteinG: 1.4, carbsG: 2.2, fatG: 0.2 },
};

export function normalizeFoodName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

/**
 * Empareja el nombre con una fila de FOOD_DB.
 * Prioriza coincidencia exacta; en subcadenas gana la clave más larga (más específica).
 */
export function findFood(name: string): { key: string; entry: FoodEntry } | null {
  const normalized = normalizeFoodName(name);
  if (!normalized) return null;

  for (const [key, entry] of Object.entries(FOOD_DB)) {
    if (normalizeFoodName(key) === normalized) return { key, entry };
  }

  let best: { key: string; entry: FoodEntry; score: number } | null = null;
  for (const [key, entry] of Object.entries(FOOD_DB)) {
    const nk = normalizeFoodName(key);
    if (normalized.includes(nk) || nk.includes(normalized)) {
      const score = nk.length;
      if (!best || score > best.score) best = { key, entry, score };
    }
  }
  return best ? { key: best.key, entry: best.entry } : null;
}

const UNKNOWN_HINT =
  "Sustitúyelos por alimentos reconocidos (ej. pasta seca cruda, pasta cocida, arroz blanco crudo, arroz cocido, pechuga de pollo cocida, aceite de oliva, platano, queso fresco 0%, queso fresco batido, leche entera, leche semidesnatada, aguacate, lentejas cocidas, garbanzos cocidos).";

/**
 * Valida una propuesta de comida contra los macros restantes del día.
 */
export function validateMealProposal(
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

  const targetKcal = Math.max(0, remaining.kcal);
  const targetP = Math.max(0, remaining.proteinG);
  const targetC = Math.max(0, remaining.carbsG);
  const targetFMin = Math.max(0, remaining.fatMinG);
  const targetFMax = Math.max(0, remaining.fatMaxG);

  const devKcal = totalKcal - targetKcal;
  const devP = totalP - targetP;
  const devC = totalC - targetC;

  const TOL_KCAL = 120;
  const TOL_PROTEIN = 15;
  const TOL_CARBS = 25;
  const FAT_OVER_LIMIT = 10;

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
    ? `\n⚠ Alimentos no reconocidos en la base de datos: ${unknowns.join(", ")}. Los macros totales pueden ser imprecisos; ${UNKNOWN_HINT}`
    : "";

  return [header, breakdown, totals, objective, deviations, footer + unknownsMsg].join("\n");
}
