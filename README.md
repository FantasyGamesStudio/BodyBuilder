# BodyBuilder

Producto: seguimiento nutricional, progreso físico, IA (comidas foto/audio), social y gamificación. Documentación de producto y técnica en este repo hasta que exista código aplicativo.

## Documentos

| Archivo | Contenido |
|---------|-----------|
| [initial_context_v1.md](./initial_context_v1.md) | Visión y contexto base |
| [functional_decisions_v1.md](./functional_decisions_v1.md) | Reglas de negocio acordadas |
| [technical_design_v0.md](./technical_design_v0.md) | Arquitectura, modelo de datos, API v0 |
| [roadmap_analista_tecnico.md](./roadmap_analista_tecnico.md) | Fases T0–T4 y handoff |
| [deferred_backlog.md](./deferred_backlog.md) | Alcance aplazado |
| [docs/adr/0001-stack-and-architecture.md](./docs/adr/0001-stack-and-architecture.md) | **Stack decidido** (Fastify, Postgres, Redis, Vite+React, …) |
| [docs/monetization_mock.md](./docs/monetization_mock.md) | Cómo simular premium sin pagos |

## Arranque rápido (API)

1. `docker compose up -d` (requiere Docker instalado).
2. `cp .env.example apps/api/.env` (o copia manual en Windows) y rellenar al menos `DATABASE_URL` y `OPENAI_API_KEY`. El asesor usa `OPENAI_ADVISOR_MODEL` (por defecto en código `gpt-4.1`; puedes poner `gpt-5.4-mini` u otro si tu cuenta lo permite).
3. `cd apps/api && npm install && npm run db:migrate && npm run dev`.
4. Probar: http://localhost:3000/health

## Siguiente paso de implementación

1. ~~Docker Compose + API mínima~~ (hecho: ver `apps/api`).
2. Registro/login JWT + `POST /me` alineado al diseño.
3. Cliente web Vite + pantalla que consuma `/health`.

## Licencia

Por definir.
