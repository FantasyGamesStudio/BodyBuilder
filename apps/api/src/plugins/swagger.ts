import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

const swaggerPlugin: FastifyPluginAsync = async (app) => {
  // ── Shared schemas (deben registrarse con addSchema para que Fastify
  //    pueda resolver $ref en rutas, además de aparecer en los docs) ────────
  app.addSchema({
    $id: "TokenResponse",
    type: "object",
    properties: {
      access_token: { type: "string" },
      token_type: { type: "string", example: "Bearer" },
      expires_in: { type: "string", example: "15m" },
      refresh_token: { type: "string" },
    },
  });

  app.addSchema({
    $id: "UserProfile",
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      userId: { type: "string", format: "uuid" },
      nickname: { type: "string" },
      accountVisibility: { type: "string", enum: ["private", "public"] },
      locale: { type: "string" },
      ianaTimezone: { type: "string" },
      sex: { type: "string", enum: ["m", "f", "other"], nullable: true },
      birthDate: { type: "string", nullable: true, example: "1995-03-20" },
      bio: { type: "string", nullable: true },
      onboardingCompleted: { type: "boolean" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  });

  app.addSchema({
    $id: "MeResponse",
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      email: { type: "string", format: "email" },
      createdAt: { type: "string", format: "date-time" },
      profile: { $ref: "UserProfile#" },
    },
  });

  app.addSchema({
    $id: "ErrorResponse",
    type: "object",
    properties: {
      error: { type: "string" },
      details: { type: "object", additionalProperties: true },
    },
  });

  // ── Swagger / OpenAPI ────────────────────────────────────────────────────
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "BodyBuilder API",
        description: "API de seguimiento nutricional y progreso físico",
        version: "0.1.0",
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
      tags: [
        { name: "health", description: "Estado del servidor" },
        { name: "auth", description: "Registro, login y tokens" },
        { name: "me", description: "Perfil del usuario autenticado" },
        { name: "onboarding", description: "Datos físicos, objetivos y cálculo de TDEE" },
        { name: "foods", description: "Catálogo de alimentos" },
        { name: "meals", description: "Registro diario de comidas" },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: true },
    staticCSP: true,
  });
};

export default fp(swaggerPlugin, { name: "swagger" });
