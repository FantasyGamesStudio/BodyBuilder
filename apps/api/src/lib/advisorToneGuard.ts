/**
 * Si el día ya no tiene margen de proteína “restante” según objetivos pero el modelo
 * usa lenguaje hiperpositivo sobre el cierre, añade un recordatorio explícito de trade-off.
 */
export function toneGuardAdvisorReply(text: string, remainingProteinG: number): string {
  if (remainingProteinG > 5) return text;

  const hyperbolic =
    /\b(excelente|cierre\s+perfecto|cierre\s+excelente|casi\s+perfecto|perfecto\s+cierre)\b/i.test(text);
  if (!hyperbolic) return text;

  return (
    `${text.trim()}\n\n` +
    "⚠️ **Nota:** Con **proteína restante muy baja o en 0 g**, añadir más proteína en esta comida es un **trade-off** respecto al objetivo del día, no un “cierre perfecto”. " +
    "Si priorizas no superar la proteína objetivo, reduce porciones de huevo/queso/carne o elige una variante con menos proteína."
  );
}
