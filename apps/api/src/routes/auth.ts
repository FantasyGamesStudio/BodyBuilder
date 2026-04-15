import { hash, verify } from "argon2";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { env } from "../lib/env.js";
import {
  daysFromNow,
  generateOpaqueToken,
  hashToken,
} from "../lib/tokens.js";

const RegisterBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  nickname: z.string().min(2).max(32),
});

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const authRoutes: FastifyPluginAsync = async (app) => {
  /** POST /v1/auth/register */
  app.post("/v1/auth/register", {
    schema: {
      tags: ["auth"],
      summary: "Registrar nuevo usuario",
      body: {
        type: "object",
        required: ["email", "password", "nickname"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 8 },
          nickname: { type: "string", minLength: 2, maxLength: 32 },
        },
      },
      response: {
        201: { $ref: "TokenResponse#" },
        400: { $ref: "ErrorResponse#" },
        409: { $ref: "ErrorResponse#" },
      },
    },
  }, async (req, reply) => {
    const body = RegisterBody.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: "invalid_input", details: body.error.flatten() });
    }
    const { email, password, nickname } = body.data;

    const existing = await db.query.users.findFirst({
      where: eq(schema.users.email, email.toLowerCase()),
    });
    if (existing) {
      return reply.status(409).send({ error: "email_taken" });
    }

    const passwordHash = await hash(password);
    const [user] = await db
      .insert(schema.users)
      .values({ email: email.toLowerCase(), passwordHash })
      .returning();

    await db.insert(schema.userProfiles).values({ userId: user.id, nickname });

    const tokens = await issueTokens(app, user.id, user.email!);
    return reply.status(201).send(tokens);
  });

  /** POST /v1/auth/login */
  app.post("/v1/auth/login", {
    schema: {
      tags: ["auth"],
      summary: "Iniciar sesión",
      body: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string" },
        },
      },
      response: {
        200: { $ref: "TokenResponse#" },
        401: { $ref: "ErrorResponse#" },
      },
    },
  }, async (req, reply) => {
    const body = LoginBody.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: "invalid_input" });
    }
    const { email, password } = body.data;

    const user = await db.query.users.findFirst({
      where: eq(schema.users.email, email.toLowerCase()),
    });

    if (!user || !user.passwordHash) {
      return reply.status(401).send({ error: "invalid_credentials" });
    }

    const valid = await verify(user.passwordHash, password);
    if (!valid) {
      return reply.status(401).send({ error: "invalid_credentials" });
    }

    const tokens = await issueTokens(app, user.id, user.email!);
    return reply.send(tokens);
  });

  /** POST /v1/auth/refresh */
  app.post("/v1/auth/refresh", {
    schema: {
      tags: ["auth"],
      summary: "Rotar refresh token y obtener nuevo access token",
      body: {
        type: "object",
        required: ["refresh_token"],
        properties: {
          refresh_token: { type: "string" },
        },
      },
      response: {
        200: { $ref: "TokenResponse#" },
        401: { $ref: "ErrorResponse#" },
      },
    },
  }, async (req, reply) => {
    const { refresh_token } = (req.body ?? {}) as { refresh_token?: string };
    if (!refresh_token) {
      return reply.status(400).send({ error: "missing_refresh_token" });
    }

    const tokenHash = hashToken(refresh_token);
    const stored = await db.query.refreshTokens.findFirst({
      where: and(
        eq(schema.refreshTokens.tokenHash, tokenHash),
        isNull(schema.refreshTokens.revokedAt),
        gt(schema.refreshTokens.expiresAt, new Date()),
      ),
    });

    if (!stored) {
      return reply.status(401).send({ error: "invalid_or_expired_token" });
    }

    await db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.refreshTokens.id, stored.id));

    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, stored.userId),
    });
    if (!user) {
      return reply.status(401).send({ error: "user_not_found" });
    }

    const tokens = await issueTokens(app, user.id, user.email!);
    return reply.send(tokens);
  });

  /** POST /v1/auth/logout */
  app.post("/v1/auth/logout", {
    schema: {
      tags: ["auth"],
      summary: "Cerrar sesión (revoca el refresh token)",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        properties: {
          refresh_token: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: { ok: { type: "boolean" } },
        },
      },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const { refresh_token } = (req.body ?? {}) as { refresh_token?: string };
    if (refresh_token) {
      const tokenHash = hashToken(refresh_token);
      await db
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(schema.refreshTokens.tokenHash, tokenHash));
    }
    return reply.send({ ok: true });
  });
};

// ─── helpers ─────────────────────────────────────────────────────────────────

async function issueTokens(
  app: Parameters<FastifyPluginAsync>[0],
  userId: string,
  email: string,
) {
  const accessToken = app.jwt.sign(
    { sub: userId, email },
    { expiresIn: env.JWT_ACCESS_EXPIRES },
  );

  const rawRefresh = generateOpaqueToken();
  const tokenHash = hashToken(rawRefresh);
  const expiresAt = daysFromNow(env.JWT_REFRESH_EXPIRES_DAYS);

  await db.insert(schema.refreshTokens).values({ userId, tokenHash, expiresAt });

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: env.JWT_ACCESS_EXPIRES,
    refresh_token: rawRefresh,
  };
}
