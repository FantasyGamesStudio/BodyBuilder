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

  it("REFINE si hay mucha pasta seca y muy poca pechuga (composición)", () => {
    // RESTANTE alineado con esta propuesta para que el fallo sea solo de composición
    const remaining = { kcal: 961, proteinG: 39, carbsG: 185, fatMinG: 4, fatMaxG: 15 };
    const out = validateMealProposal(
      [
        { name: "pechuga de pollo cocida", grams: 20 },
        { name: "pasta seca cruda", grams: 250 },
      ],
      remaining,
    );
    expect(out).toContain("VEREDICTO: REFINE");
    expect(out).toMatch(/composición/i);
  });

  it("OK con pasta razonable y pechuga suficiente", () => {
    const remaining = { kcal: 771, proteinG: 60, carbsG: 111, fatMinG: 5, fatMaxG: 12 };
    const out = validateMealProposal(
      [
        { name: "pechuga de pollo cocida", grams: 130 },
        { name: "pasta seca cruda", grams: 150 },
      ],
      remaining,
    );
    expect(out).toContain("VEREDICTO: OK");
  });
});
