import { describe, expect, it } from "vitest";
import {
  assistantResponseHasConcreteQuantities,
  isValidateMealOkResult,
  userWantsQuantifiedMealAdvice,
} from "../../lib/advisorQuantityEnforcement.js";

describe("userWantsQuantifiedMealAdvice", () => {
  it("detecta preguntas por macros y cómo cerrar el día", () => {
    expect(userWantsQuantifiedMealAdvice("¿cómo quedarían las macros con la opción A?")).toBe(true);
    expect(userWantsQuantifiedMealAdvice("quiero cerrar objetivos en la cena")).toBe(true);
    expect(userWantsQuantifiedMealAdvice("cuántas kcal me quedan")).toBe(true);
  });

  it("detecta intención cena + qué como", () => {
    expect(userWantsQuantifiedMealAdvice("¿qué ceno hoy para no pasarme de calorías?")).toBe(true);
  });

  it("no activa en mensajes cortos o solo agradecimiento", () => {
    expect(userWantsQuantifiedMealAdvice("gracias")).toBe(false);
    expect(userWantsQuantifiedMealAdvice("ok")).toBe(false);
  });
});

describe("assistantResponseHasConcreteQuantities", () => {
  it("detecta gramos y tablas de macros", () => {
    expect(assistantResponseHasConcreteQuantities("Pasta cocida: 280g")).toBe(true);
    expect(assistantResponseHasConcreteQuantities("Total cena: 893 kcal | P:27g")).toBe(true);
    expect(assistantResponseHasConcreteQuantities("| P: 12g | C: 40g")).toBe(true);
  });

  it("no activa en texto solo cualitativo", () => {
    expect(assistantResponseHasConcreteQuantities("Puedes priorizar verduras y proteína magra.")).toBe(false);
  });
});

describe("isValidateMealOkResult", () => {
  it("reconoce veredicto OK", () => {
    expect(isValidateMealOkResult("VEREDICTO: OK\nDESGLOSE")).toBe(true);
    expect(isValidateMealOkResult("veredicto: ok")).toBe(false);
  });

  it("rechaza REFINE", () => {
    expect(isValidateMealOkResult("VEREDICTO: REFINE\najusta")).toBe(false);
  });
});
