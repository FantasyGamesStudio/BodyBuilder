import { describe, expect, it } from "vitest";
import { computeDayProgress, computeMacros } from "../../lib/nutrition.js";

const CHICKEN = {
  kcalPer100g: 165,
  proteinPer100g: 31,
  fatPer100g: 3.6,
  carbsPer100g: 0,
};

const RICE = {
  kcalPer100g: 130,
  proteinPer100g: 2.7,
  fatPer100g: 0.3,
  carbsPer100g: 28,
};

describe("computeMacros", () => {
  it("calcula correctamente para 100 g (factor = 1)", () => {
    const result = computeMacros(CHICKEN, 100);
    expect(result.kcal).toBe(165);
    expect(result.proteinG).toBe(31);
    expect(result.fatG).toBe(3.6);
    expect(result.carbsG).toBe(0);
  });

  it("escala proporcionalmente para 200 g", () => {
    const result = computeMacros(CHICKEN, 200);
    expect(result.kcal).toBe(330);
    expect(result.proteinG).toBe(62);
    expect(result.fatG).toBe(7.2);
  });

  it("escala para porciones pequeñas (50 g)", () => {
    const result = computeMacros(RICE, 50);
    expect(result.kcal).toBe(65);
    expect(result.proteinG).toBe(1.4);
    expect(result.carbsG).toBe(14);
  });

  it("devuelve kcal como entero redondeado", () => {
    // 165 × 0.75 = 123.75 → 124
    const result = computeMacros(CHICKEN, 75);
    expect(result.kcal).toBe(124);
    expect(Number.isInteger(result.kcal)).toBe(true);
  });

  it("redondea proteinG a 1 decimal", () => {
    // 31 × 0.3 = 9.3
    const result = computeMacros(CHICKEN, 30);
    expect(result.proteinG).toBe(9.3);
  });

  it("devuelve 0 para carbsG cuando el alimento no tiene carbos", () => {
    const result = computeMacros(CHICKEN, 150);
    expect(result.carbsG).toBe(0);
  });
});

describe("computeDayProgress", () => {
  const TARGET = {
    kcalTarget: 2500,
    proteinMinG: 180,
    fatMinG: 55,
    fatMaxG: 97,
    carbsG: 280,
    kcalGreenPct: 7,
  };

  it("acumula totales de múltiples entradas correctamente", () => {
    const entries = [
      computeMacros(CHICKEN, 200), // 330 kcal
      computeMacros(RICE, 150),    // 195 kcal
    ];
    const { totals } = computeDayProgress(entries, TARGET);
    expect(totals.kcal).toBe(525);
    expect(totals.proteinG).toBe(computeMacros(CHICKEN, 200).proteinG + computeMacros(RICE, 150).proteinG);
  });

  it("devuelve totales en 0 para día vacío", () => {
    const { totals } = computeDayProgress([], TARGET);
    expect(totals.kcal).toBe(0);
    expect(totals.proteinG).toBe(0);
  });

  it("estado 'green' cuando kcal está dentro del ±7 %", () => {
    // TARGET 2500 kcal, margen = 175; verde = [2325, 2675]
    const entries = [{ kcal: 2500, proteinG: 0, fatG: 0, carbsG: 0 }];
    expect(computeDayProgress(entries, TARGET).kcalStatus).toBe("green");
  });

  it("estado 'green' en el límite inferior (2325 kcal)", () => {
    const entries = [{ kcal: 2325, proteinG: 0, fatG: 0, carbsG: 0 }];
    expect(computeDayProgress(entries, TARGET).kcalStatus).toBe("green");
  });

  it("estado 'yellow' justo por debajo del verde (2200 kcal)", () => {
    const entries = [{ kcal: 2200, proteinG: 0, fatG: 0, carbsG: 0 }];
    expect(computeDayProgress(entries, TARGET).kcalStatus).toBe("yellow");
  });

  it("estado 'red' muy por debajo del objetivo (< 85 % del límite inferior)", () => {
    // Límite rojo inferior: 2325 × 0.85 ≈ 1976
    const entries = [{ kcal: 1500, proteinG: 0, fatG: 0, carbsG: 0 }];
    expect(computeDayProgress(entries, TARGET).kcalStatus).toBe("red");
  });

  it("kcalPct refleja el porcentaje respecto al objetivo", () => {
    const entries = [{ kcal: 1250, proteinG: 0, fatG: 0, carbsG: 0 }];
    expect(computeDayProgress(entries, TARGET).kcalPct).toBe(50);
  });

  it("proteinPct al 100 % cuando se alcanza proteinMinG exacto", () => {
    const entries = [{ kcal: 0, proteinG: 180, fatG: 0, carbsG: 0 }];
    expect(computeDayProgress(entries, TARGET).proteinPct).toBe(100);
  });

  it("kcalStatus es 'green' con tolerancia del 5 % (mantenimiento)", () => {
    const strictTarget = { ...TARGET, kcalGreenPct: 5 };
    // Margen = 125; verde = [2375, 2625]
    const inRange = [{ kcal: 2400, proteinG: 0, fatG: 0, carbsG: 0 }];
    const outOfRange = [{ kcal: 2350, proteinG: 0, fatG: 0, carbsG: 0 }];
    expect(computeDayProgress(inRange, strictTarget).kcalStatus).toBe("green");
    expect(computeDayProgress(outOfRange, strictTarget).kcalStatus).not.toBe("green");
  });
});
