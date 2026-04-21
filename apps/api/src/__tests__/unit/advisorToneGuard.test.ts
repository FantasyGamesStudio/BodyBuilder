import { describe, expect, it } from "vitest";
import { toneGuardAdvisorReply } from "../../lib/advisorToneGuard.js";

describe("toneGuardAdvisorReply", () => {
  it("no modifica si queda margen de proteína", () => {
    const t = "✅ Cierre excelente.";
    expect(toneGuardAdvisorReply(t, 40)).toBe(t);
  });

  it("añade aviso si margen bajo y tono hiperbólico", () => {
    const t = "✅ Cierre excelente para el día.";
    const out = toneGuardAdvisorReply(t, 0);
    expect(out).toContain("trade-off");
    expect(out).toContain("Cierre excelente");
  });
});
