import { describe, expect, it } from "vitest";
import {
  normalizeEntryToReferenceGrams,
  RECURRING_REFERENCE_GRAMS,
  scaleRecurringToLoggedQuantity,
} from "../../lib/recurringFood.js";

describe("normalizeEntryToReferenceGrams", () => {
  it("escala 260 g de pollo a macros por 100 g", () => {
    const out = normalizeEntryToReferenceGrams({
      kcal: 429,
      quantityG: "260",
      proteinG: "81.9",
      fatG: "9.1",
      carbsG: "0",
    });
    expect(out.quantityG).toBe(String(RECURRING_REFERENCE_GRAMS));
    expect(out.kcalPerServing).toBe(Math.round((429 * 100) / 260));
    expect(Number(out.proteinG)).toBeCloseTo((81.9 * 100) / 260, 1);
    expect(Number(out.fatG)).toBeCloseTo((9.1 * 100) / 260, 1);
    expect(Number(out.carbsG)).toBeCloseTo(0, 1);
  });

  it("si cantidad inválida, conserva valores como fallback en ref 100", () => {
    const out = normalizeEntryToReferenceGrams({
      kcal: 200,
      quantityG: "0",
      proteinG: "30",
      fatG: "10",
      carbsG: "5",
    });
    expect(out.quantityG).toBe("100");
    expect(out.kcalPerServing).toBe(200);
  });
});

describe("scaleRecurringToLoggedQuantity", () => {
  it("desde referencia 100 g, 260 g registrados escala bien", () => {
    const logged = scaleRecurringToLoggedQuantity(
      {
        quantityG: "100",
        kcalPerServing: 165,
        proteinG: "31.0",
        fatG: "3.6",
        carbsG: "0",
      },
      260,
    );
    expect(logged.quantityG).toBe("260.0");
    expect(logged.kcal).toBe(Math.round(165 * 2.6));
    expect(Number(logged.proteinG)).toBeCloseTo(31 * 2.6, 1);
  });

  it("compatibilidad: favorito legacy 260 g con totales para 260 g → 130 g mitad", () => {
    const logged = scaleRecurringToLoggedQuantity(
      {
        quantityG: "260",
        kcalPerServing: 429,
        proteinG: "81.9",
        fatG: "9.1",
        carbsG: "0",
      },
      130,
    );
    expect(Number(logged.quantityG)).toBeCloseTo(130, 1);
    expect(logged.kcal).toBe(Math.round(429 / 2));
    expect(Number(logged.proteinG)).toBeCloseTo(81.9 / 2, 1);
  });
});
