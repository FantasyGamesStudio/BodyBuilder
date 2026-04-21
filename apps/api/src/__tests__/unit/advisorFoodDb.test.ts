import { describe, expect, it } from "vitest";
import { findFood, FOOD_DB, validateMealProposal } from "../../lib/advisorFoodDb.js";

describe("findFood", () => {
  it("prioriza la clave más específica entre subcadenas ambiguas", () => {
    const a = findFood("pasta");
    expect(a?.key).toBe("pasta seca cruda");
  });

  it("resuelve pasta seca cruda y arroz blanco crudo por nombre exacto", () => {
    expect(findFood("pasta seca cruda")?.entry.kcal).toBe(FOOD_DB["pasta seca cruda"].kcal);
    expect(findFood("arroz blanco crudo")?.entry.kcal).toBe(FOOD_DB["arroz blanco crudo"].kcal);
  });

  it("encuentra queso fresco batido", () => {
    expect(findFood("queso fresco batido")?.key).toBe("queso fresco batido");
  });
});

describe("validateMealProposal", () => {
  it("calcula totales con pasta seca cruda (gramos secos)", () => {
    const remaining = { kcal: 900, proteinG: 30, carbsG: 150, fatMinG: 10, fatMaxG: 40 };
    const out = validateMealProposal([{ name: "pasta seca cruda", grams: 100 }], remaining);
    expect(out).toContain("VEREDICTO:");
    expect(out).toContain("pasta seca cruda");
    expect(out).toMatch(/TOTAL PROPUESTO: 371 kcal/);
  });
});
