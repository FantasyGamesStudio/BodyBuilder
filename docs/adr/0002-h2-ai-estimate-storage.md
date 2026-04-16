# ADR 0002 — Almacenamiento de la estimación IA en columnas de `meal_log_entries`

**Estado:** aceptado  
**Fecha:** 2026-04-16  
**Contexto:** H2 — flujo IA de registro de comidas con foto/audio.

---

## Contexto

Al finalizar el pipeline IA (STT Whisper + visión GPT-4o → JSON nutricional), hay que almacenar la estimación de la IA de forma que:

1. El frontend pueda mostrarla al usuario para revisión antes de confirmar.
2. El usuario pueda editarla o rechazarla y guardar sus propios valores.
3. La entrada confirmada sea la que alimenta los totales del día.

---

## Opciones consideradas

**Opción A — Columnas top-level de `meal_log_entries`**  
La estimación IA escribe directamente `kcal`, `proteinG`, `fatG`, `carbsG`, `foodName` en la entrada y cambia `status` a `pending_user_review`. Si el usuario confirma sin editar, ya están los valores correctos.  

**Opción B — Columna separada `ai_estimate` (JSONB) en `meal_log_entries`**  
La estimación IA se guarda en `ai_estimate` y los campos top-level quedan en 0 hasta que el usuario confirma, momento en el que se copian.

---

## Decisión

Se eligió la **Opción A**. Motivos:

- Los totales del día solo se calculan sobre entradas `confirmed` o `corrected`, por lo que escribir la estimación en las columnas top-level no contamina los totales mientras el status sea `pending_user_review`.
- Evita duplicidad: los mismos campos sirven tanto para la estimación IA como para el valor confirmado.
- El detalle de la estimación original (incluyendo `reasoning`, `line_items`, tokens usados) está disponible en `ai_interactions.outputParsed` para auditoría y para el frontend si lo necesita.
- La API GET `/v1/meals/:id` extrae y expone `aiEstimate` del último `ai_interactions.outputParsed` como un objeto derivado, sin almacenamiento redundante.

---

## Consecuencias

- `MealDetail.aiEstimate` en el tipo frontend es un campo **derivado** en runtime, no almacenado directamente.
- Si la IA escribe valores y el usuario no revisa la entrada, los campos top-level reflejan la estimación IA (pero el status impide que cuenten en los totales).
- El historial de correcciones se guarda en `meal_corrections.previousSnapshot` para trazabilidad.

---

## Estado conocido / trabajo futuro

- La columna `summaryCompact` de `coaching_threads` (diseñada para resumir hilos largos) no está implementada. El hilo usa historial completo (hasta 20 mensajes). Se pospone a H3 — ver `deferred_backlog.md`.
