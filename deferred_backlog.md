# Backlog aplazado — BodyBuilder

Ítems explícitamente marcados como *obviar por ahora*, *más adelante* o fuera del foco de la primera versión privada. Sirve para retomarlos sin perder contexto.

## Cumplimiento y edad

- Edad mínima, menores, consentimiento parental y marco legal de salud orientado a público general.

## Restricciones dietéticas

- Preferencias y restricciones en onboarding y su impacto en sugerencias del LLM (ahora obviado).

## Social — moderación y descubrimiento

- Moderación de contenido (reportes, bloqueo, revisión humana o filtros automáticos).
- Descubrimiento (búsqueda por nombre, hashtags, recomendaciones de usuarios).

## Gamificación

- Reglas anti-abuso / anti-farming de XP o moneda.

## No funcionales

- RGPD / privacidad formal (DPA, bases legales, exportación/borrado de cuenta detallado).
- Accesibilidad (objetivo WCAG, lectores de pantalla, contraste).
- Canal de soporte (email, in-app, FAQ).

## Producto / datos

- Exportación de histórico (CSV/PDF) — ahora no requerida; datos se guardan en backend de forma indefinida.

## Límites de uso IA (cuando deje de ser solo uso privado)

- Topes diarios de inferencias, mensajes de asistente y comportamiento en caso de superarlos.

## Social — límites y anti-spam

- Tope de solicitudes de seguimiento por día/usuario, reintentos tras rechazo, etc. (post-MVP prueba privada).

## Monetización

- **Suscripción de pago** (recurrencia mensual u otra): pasarela (Stripe, etc.), impuestos, facturas, webhooks, gestión de bajas y períodos de gracia.
- **Catálogo de perks** para miembros (ej. informe semanal premium, límites de IA distintos) — detalle funcional en iteración previa a desarrollo.
- **Pase de batalla / temporadas:** definición de misiones, tablas de recompensas, doble pista gratis vs miembro, cosméticos exclusivos de temporada.
- **Pagos in-app** Apple / Google cuando exista cliente nativo (IAP vs reglas de cada tienda).

## Producto / nutrición avanzada

- Toggle **eat-back** solo donde producto lo permita (**volumen / mantenimiento**); **no** en déficit — ver `functional_decisions_v1.md` §13.1.

## IA — Coaching (H2)

- **Summarización de hilos de coaching** (`coaching_threads.summaryCompact`): el campo existe en el schema pero no se rellena. El hilo usa hasta 20 mensajes en crudo como contexto. Cuando los hilos sean largos, implementar un job de resumen periódico (LLM → `summaryCompact`) para reducir coste de tokens.
- **Imágenes de coaching en object storage**: actualmente las imágenes enviadas al coach se transmiten inline como base64 al LLM pero **no se almacenan en S3/R2**. El campo `attachmentObjectKey` se guarda a `null`. Si en el futuro se quiere persistir las imágenes (para auditoría, re-análisis, etc.), añadir el upload presignado antes de la llamada al LLM.

---

*Última actualización: suscripción + pase de batalla en backlog; política medios y NEAT baseline cerradas en funcional §13; H2 coaching gaps añadidos 2026-04-16.*
