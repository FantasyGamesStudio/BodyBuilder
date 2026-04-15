import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db, schema } from "../db/index.js";

const PatchMeBody = z.object({
  nickname: z.string().min(2).max(32).optional(),
  accountVisibility: z.enum(["private", "public"]).optional(),
  locale: z.string().optional(),
  ianaTimezone: z.string().optional(),
  sex: z.enum(["m", "f", "other"]).nullable().optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  bio: z.string().max(300).nullable().optional(),
});

export const meRoutes: FastifyPluginAsync = async (app) => {
  /** GET /v1/me */
  app.get("/v1/me", {
    schema: {
      tags: ["me"],
      summary: "Obtener perfil del usuario autenticado",
      security: [{ bearerAuth: [] }],
      response: {
        200: { $ref: "MeResponse#" },
        404: { $ref: "ErrorResponse#" },
      },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const userId = req.user.sub;

    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
      columns: { id: true, email: true, createdAt: true },
      with: { profile: true },
    });

    if (!user) return reply.status(404).send({ error: "user_not_found" });

    return reply.send({
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
      profile: user.profile,
    });
  });

  /** PATCH /v1/me */
  app.patch("/v1/me", {
    schema: {
      tags: ["me"],
      summary: "Actualizar perfil del usuario autenticado",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        properties: {
          nickname: { type: "string", minLength: 2, maxLength: 32 },
          accountVisibility: { type: "string", enum: ["private", "public"] },
          locale: { type: "string" },
          ianaTimezone: { type: "string" },
          sex: { type: "string", enum: ["m", "f", "other"], nullable: true },
          birthDate: { type: "string", nullable: true },
          bio: { type: "string", maxLength: 300, nullable: true },
        },
      },
      response: {
        200: { $ref: "MeResponse#" },
        400: { $ref: "ErrorResponse#" },
      },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const userId = req.user.sub;
    const body = PatchMeBody.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: "invalid_input", details: body.error.flatten() });
    }

    const { nickname, ...profileFields } = body.data;

    if (nickname) {
      await db
        .update(schema.userProfiles)
        .set({ nickname, updatedAt: new Date() })
        .where(eq(schema.userProfiles.userId, userId));
    }

    if (Object.keys(profileFields).length > 0) {
      await db
        .update(schema.userProfiles)
        .set({ ...profileFields, updatedAt: new Date() })
        .where(eq(schema.userProfiles.userId, userId));
    }

    const updated = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
      columns: { id: true, email: true, createdAt: true },
      with: { profile: true },
    });

    return reply.send(updated);
  });
};
