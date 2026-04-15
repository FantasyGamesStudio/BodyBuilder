# ADR 0001 — Stack y arquitectura base (MVP web)

**Estado:** aceptado  
**Fecha:** 2026-04-14  
**Contexto:** `technical_design_v0.md` v0.3, cliente web primero, API REST, cola para IA, Postgres, objeto para medios.

---

## Contexto

- Hay que desplegar un **vertical slice H1** (auth, día nutricional, comidas manuales, objetivos) sin bloquear H2 (IA, coach).
- El equipo quiere **TypeScript** compartido entre API y front donde sea posible.
- Entorno de desarrollo en **Windows** compatible; producción en contenedor o PaaS habitual.

---

## Decisión

| Capa | Elección | Motivo breve |
|------|----------|----------------|
| **API HTTP** | **Fastify** + **TypeScript** | Ligero, tipado, plugins JWT/multipart; alternativa válida NestJS si más tarde se prefiere DI pesada. |
| **ORM / migraciones** | **Drizzle ORM** + SQL explícito | Tipos inferidos, migraciones en repo; **Prisma** es alternativa aceptable si el equipo la prefiere. |
| **Base de datos** | **PostgreSQL 16+** | Relacional, JSONB para payloads flex (IA, charts_spec), madurez. |
| **Cola / jobs** | **BullMQ** + **Redis 7+** | IA asíncrona, notificaciones, purga de coach; Redis también útil para rate limit futuro. |
| **Almacenamiento objetos** | API **S3-compatible** (MinIO local, **Cloudflare R2** / AWS S3 prod) | Fotos/audio; URLs firmadas como en diseño v0. |
| **Cliente web** | **React 19** + **Vite** + **React Router** | SPA alineada con MVP; SSR (**Next.js**) solo si aparece necesidad SEO o hosting unificado. |
| **Auth** | **JWT** (access corto + refresh en httpOnly cookie o rotación en tabla `refresh_token`) + OAuth Google/Apple vía proveedor | Encaja con `technical_design_v0.md`. |
| **Contrato API** | **OpenAPI 3.1** generado desde código (p. ej. `@fastify/swagger`) o mano + validación **Zod** | Una fuente de verdad para el front. |
| **Contenedores** | **Docker Compose** (api, web, postgres, redis, minio) para dev | Un comando para levantar stack local. |
| **Observabilidad** | **Pino** (logs JSON) + `request_id`; métricas opcionales Prometheus después | Suficiente para MVP privado. |

### Monorepo

- **`apps/api`** — servidor Fastify, workers BullMQ (proceso separado o mismo repo `apps/worker`).
- **`apps/web`** — SPA Vite.
- **`packages/shared`** (opcional) — tipos Zod/OpenAPI compartidos, constantes de dominio.

Gestor de paquetes: **pnpm** (`pnpm-workspace.yaml`).

---

## Consecuencias

- **Positivo:** un solo lenguaje principal (TS), despliegue simple de API + front, encaje con diseño existente.
- **Negativo:** workers en Node (no Python); integración STT/visión vía HTTP a proveedores externos (OpenRouter, Whisper API, etc.), lo cual ya asume el diseño en cadena.
- **Revisión:** si el equipo impone NestJS o Next.js, este ADR se enmienda sin cambiar el modelo de datos.

---

## No incluido en esta decisión

- Proveedor concreto de hosting (Fly.io, Railway, Render, VPS).
- Modelos exactos en OpenRouter (spike técnico aparte).

---

## Referencias

- `technical_design_v0.md` §14 (próximos pasos).
- `functional_decisions_v1.md`.
