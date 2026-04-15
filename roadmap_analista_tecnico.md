# Ritmo y handoff para analista técnico

## Estado actual (lectura obligatoria)

| Documento | Rol |
|-----------|-----|
| `initial_context_v1.md` | Visión, pilares, principios, anti‑patrones. |
| `functional_decisions_v1.md` | **Fuente de verdad funcional** acordada (v1). |
| `technical_design_v0.md` | Diseño técnico v0.x. |
| `docs/adr/0001-stack-and-architecture.md` | Stack para implementación (Fastify, Postgres, …). |
| `deferred_backlog.md` | Fuera de alcance inmediato; no diseñar hasta retomar. |

---

## Qué debe producir el analista técnico

Salida mínima para pasar a arquitectura/implementación sin ambigüedades críticas:

1. **Arquitectura lógica** — capas (cliente, API, datos, jobs, integración OpenRouter, almacenamiento de medios, notificaciones).
2. **Modelo de datos** — entidades, relaciones, campos clave, estados (ej. comida borrador / confirmada), retención de interacciones IA.
3. **Contratos** — listado de capacidades (REST/GraphQL/eventos) o OpenAPI esquemático; autenticación (JWT, OAuth).
4. **Flujos críticos** — secuencia: registro comida foto+audio → estimación → corrección; ajuste de objetivos; post social; cola offline.
5. **IA** — pipeline multimodal (STT, visión, unificación en prompt o modelo único), esquema JSON de salida nutricional, límites y disclaimers.
6. **No funcionales v1** — seguridad básica, backups, entornos, coste/observabilidad mínima (aunque RGPD vaya al backlog explícito).
7. **Orden de entrega** — hitos internos que respeten el alcance amplio sin pretender un único “big bang” (ver riesgo en `functional_decisions_v1.md` §11).

---

## Ritmo sugerido (fases)

| Fase | Enfoque | Duración orientativa* |
|------|---------|------------------------|
| **T0** | Lectura de los 3 docs + lista de dudas solo si bloquean diseño | 0,5–1 día |
| **T1** | Dominio núcleo: usuarios, día nutricional, comidas, objetivos, peso/medidas, entreno (calendario + toggle) | 2–4 días |
| **T2** | IA: estimación, trazabilidad, almacenamiento audio/imagen, catálogo interno incremental | 2–4 días |
| **T3** | Social + gamificación + notificaciones + evaluaciones periódicas | 3–6 días |
| **T4** | Consolidación: diagramas, decisiones ADR cortas, checklist de seguridad/costes | 1–2 días |

\* Depende de profundidad; el orden **T1 → T2 → T3** reduce retrabajo (el pipeline multimodal apoya al registro de comidas).

---

## Siguiente paso concreto (ahora)

**Paso único siguiente:** que el analista técnico ejecute **T0 + arranque de T1**:

1. Leer `functional_decisions_v1.md` y anotar **solo** incógnitas que impidan dibujar el modelo de datos o los flujos (ej. perfil “mixto”, lista cerrada de “objetivos cumplidos” en posts).
2. Redactar el **documento de diseño técnico v0** con:
   - diagrama de contexto (C4 nivel 1 o equivalente),
   - **primer borrador del modelo de datos** (entidades y relaciones),
   - flujo en pseudosecuencia del **registro de comida con foto + audio**.

Hasta que exista ese **diseño técnico v0**, no hace falta bajar a stack concreto (React Native vs Flutter, Postgres vs …) salvo preferencia ya fijada por el equipo.

---

## Prompt sugerido para el agente analista técnico

```
Eres analista técnico. Lee initial_context_v1.md, functional_decisions_v1.md y
deferred_backlog.md. No diseñes lo aplazado en deferred_backlog salvo interfaces
extensibles. Entrega: (1) arquitectura lógica, (2) modelo de datos v0,
(3) flujos críticos en secuencia, (4) contrato API esquemático, (5) diseño del
pipeline IA multimodal y JSON de salida nutricional, (6) orden de hitos de
implementación. Marca explícitamente dependencias y riesgos.
```

---

## Estado del handoff

- **`technical_design_v0.md`** — v0.3+; §14 enlaza **ADR 0001**.
- **`docs/adr/0001-stack-and-architecture.md`** — stack congelado; monorepo `pnpm` iniciado en raíz.

*Actualizar este archivo cuando cambie la versión del diseño técnico.*
