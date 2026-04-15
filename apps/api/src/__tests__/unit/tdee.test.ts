import { describe, expect, it } from "vitest";
import { calcTdee } from "../../lib/tdee.js";

// ─── Caso base de referencia ──────────────────────────────────────────────────
// Hombre, 80 kg, 178 cm, 30 años, moderadamente activo
// BMR  = 10×80 + 6.25×178 − 5×30 + 5 = 800 + 1112.5 − 150 + 5 = 1767.5 → 1768
// TDEE = 1768 × 1.55 = 2740.4 → 2740

const BASE = {
  weightKg: 80,
  heightCm: 178,
  ageYears: 30,
  sex: "m" as const,
  activityLevel: "moderately_active" as const,
};

describe("calcTdee — BMR y TDEE", () => {
  it("calcula BMR con Mifflin-St Jeor para hombre", () => {
    const r = calcTdee({ ...BASE, goalMode: "mantenimiento" });
    expect(r.bmr).toBe(1768);
  });

  it("calcula TDEE aplicando el factor de actividad correcto (×1.55)", () => {
    const r = calcTdee({ ...BASE, goalMode: "mantenimiento" });
    expect(r.tdee).toBe(2740);
  });

  it("calcula BMR para mujer (fórmula − 161)", () => {
    const r = calcTdee({ ...BASE, sex: "f", goalMode: "mantenimiento" });
    // BMR = 10×80 + 6.25×178 − 5×30 − 161 = 1601.5 → 1602
    expect(r.bmr).toBe(1602);
  });

  it("calcula BMR para 'other' como media de m y f", () => {
    const rm = calcTdee({ ...BASE, sex: "m", goalMode: "mantenimiento" });
    const rf = calcTdee({ ...BASE, sex: "f", goalMode: "mantenimiento" });
    const ro = calcTdee({ ...BASE, sex: "other", goalMode: "mantenimiento" });
    expect(ro.bmr).toBe(Math.round((rm.bmr + rf.bmr) / 2));
  });

  it("TDEE sedentario usa factor ×1.2", () => {
    const r = calcTdee({ ...BASE, activityLevel: "sedentary", goalMode: "mantenimiento" });
    expect(r.tdee).toBe(Math.round(r.bmr * 1.2));
  });

  it("TDEE extra_active usa factor ×1.9", () => {
    const r = calcTdee({ ...BASE, activityLevel: "extra_active", goalMode: "mantenimiento" });
    expect(r.tdee).toBe(Math.round(r.bmr * 1.9));
  });
});

describe("calcTdee — delta calórico por objetivo", () => {
  it("volumen_limpio añade +300 kcal al TDEE", () => {
    const r = calcTdee({ ...BASE, goalMode: "volumen_limpio" });
    expect(r.kcalTarget).toBe(r.tdee + 300);
  });

  it("mantenimiento no modifica el TDEE", () => {
    const r = calcTdee({ ...BASE, goalMode: "mantenimiento" });
    expect(r.kcalTarget).toBe(r.tdee);
  });

  it("definicion resta 400 kcal al TDEE", () => {
    const r = calcTdee({ ...BASE, goalMode: "definicion" });
    expect(r.kcalTarget).toBe(r.tdee - 400);
  });

  it("recomposicion no modifica el TDEE", () => {
    const r = calcTdee({ ...BASE, goalMode: "recomposicion" });
    expect(r.kcalTarget).toBe(r.tdee);
  });

  it("perdida_peso resta 600 kcal al TDEE", () => {
    const r = calcTdee({ ...BASE, goalMode: "perdida_peso" });
    expect(r.kcalTarget).toBe(r.tdee - 600);
  });

  it("kcalTarget nunca baja de 1200 (límite de seguridad)", () => {
    // Mujer, muy ligera, sedentaria, objetivo de pérdida agresiva
    const r = calcTdee({
      weightKg: 45,
      heightCm: 150,
      ageYears: 25,
      sex: "f",
      activityLevel: "sedentary",
      goalMode: "perdida_peso",
    });
    expect(r.kcalTarget).toBeGreaterThanOrEqual(1200);
  });
});

describe("calcTdee — distribución de proteína", () => {
  it("proteína en volumen = 2.2 g/kg", () => {
    const r = calcTdee({ ...BASE, goalMode: "volumen_limpio" });
    expect(r.proteinMinG).toBe(Math.round(80 * 2.2));
  });

  it("proteína en definición = 2.4 g/kg (mayor para preservar músculo)", () => {
    const r = calcTdee({ ...BASE, goalMode: "definicion" });
    expect(r.proteinMinG).toBe(Math.round(80 * 2.4));
  });

  it("proteína en mantenimiento = 2.0 g/kg", () => {
    const r = calcTdee({ ...BASE, goalMode: "mantenimiento" });
    expect(r.proteinMinG).toBe(Math.round(80 * 2.0));
  });
});

describe("calcTdee — rangos de grasa", () => {
  it("fatMinG representa el 20 % de kcalTarget ÷ 9", () => {
    const r = calcTdee({ ...BASE, goalMode: "mantenimiento" });
    expect(r.fatMinG).toBe(Math.round((r.kcalTarget * 0.20) / 9));
  });

  it("fatMaxG representa el 35 % de kcalTarget ÷ 9", () => {
    const r = calcTdee({ ...BASE, goalMode: "mantenimiento" });
    expect(r.fatMaxG).toBe(Math.round((r.kcalTarget * 0.35) / 9));
  });

  it("fatMinG siempre es menor que fatMaxG", () => {
    for (const goalMode of [
      "volumen_limpio",
      "mantenimiento",
      "definicion",
      "recomposicion",
      "perdida_peso",
    ] as const) {
      const r = calcTdee({ ...BASE, goalMode });
      expect(r.fatMinG).toBeLessThan(r.fatMaxG);
    }
  });
});

describe("calcTdee — carbohidratos", () => {
  it("carbsG cubre el resto de calorías tras proteína y grasa diana (25 %)", () => {
    const r = calcTdee({ ...BASE, goalMode: "volumen_limpio" });
    const proteinKcal = r.proteinMinG * 4;
    const fatTargetG = Math.round((r.kcalTarget * 0.25) / 9);
    const fatKcal = fatTargetG * 9;
    const expectedCarbs = Math.round(Math.max(0, r.kcalTarget - proteinKcal - fatKcal) / 4);
    expect(r.carbsG).toBe(expectedCarbs);
  });

  it("carbsG es >= 0 incluso con macros muy altos", () => {
    const r = calcTdee({
      weightKg: 120,
      heightCm: 185,
      ageYears: 25,
      sex: "m",
      activityLevel: "sedentary",
      goalMode: "perdida_peso",
    });
    expect(r.carbsG).toBeGreaterThanOrEqual(0);
  });
});

describe("calcTdee — tolerancia de zona verde (kcalGreenPct)", () => {
  it("volumen_limpio y definicion tienen tolerancia del 7 %", () => {
    expect(calcTdee({ ...BASE, goalMode: "volumen_limpio" }).kcalGreenPct).toBe(7);
    expect(calcTdee({ ...BASE, goalMode: "definicion" }).kcalGreenPct).toBe(7);
  });

  it("mantenimiento y recomposicion tienen tolerancia del 5 % (más estrictos)", () => {
    expect(calcTdee({ ...BASE, goalMode: "mantenimiento" }).kcalGreenPct).toBe(5);
    expect(calcTdee({ ...BASE, goalMode: "recomposicion" }).kcalGreenPct).toBe(5);
  });
});

describe("calcTdee — sugerencia NEAT", () => {
  it("sedentario recibe la mayor sugerencia de pasos (8000)", () => {
    const r = calcTdee({ ...BASE, activityLevel: "sedentary", goalMode: "mantenimiento" });
    expect(r.neatSuggestedSteps).toBe(8000);
  });

  it("very_active recibe la menor sugerencia de pasos (5000)", () => {
    const r = calcTdee({ ...BASE, activityLevel: "very_active", goalMode: "mantenimiento" });
    expect(r.neatSuggestedSteps).toBe(5000);
  });
});
