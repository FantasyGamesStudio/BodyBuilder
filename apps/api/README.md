# API (BodyBuilder)

Fastify + TypeScript + Drizzle + PostgreSQL. Ver `docs/adr/0001-stack-and-architecture.md`.

## Requisitos

- Node.js **18.12+** (recomendado **20 LTS**).
- Docker Desktop (o motor compatible) para Postgres, Redis y MinIO — opcional si ya tienes servicios locales.

## Arranque local

1. En la raíz del repo: `docker compose up -d` (levanta Postgres, Redis, MinIO).
2. Copia `.env.example` de la raíz a **`apps/api/.env`** y ajusta si hace falta.
3. Aplica el esquema (elige una opción):
   - **Migraciones:** `npm run db:migrate`
   - **Solo dev (sincroniza esquema):** `npm run db:push`
4. Desarrollo: `npm run dev` (desde esta carpeta).

Endpoints:

- `GET /health` — vivo (sin base de datos).
- `GET /health/ready` — comprueba `DATABASE_URL` y `SELECT 1`.

## MinIO

Consola: http://localhost:9001 (usuario `minio`, contraseña `minio12345`). Crea el bucket `bodybuilder` antes de usar subida de medios.

## Notas

- En este entorno se usó **npm** dentro de `apps/api` si `pnpm` no está instalado; el monorepo sigue pensado para **pnpm** cuando lo actives (`corepack enable`).
