import { ilike, or } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db, schema } from "../db/index.js";

const CreateFoodBody = z.object({
  name: z.string().min(2).max(120),
  brand: z.string().max(80).optional(),
  kcalPer100g: z.number().nonnegative().max(9000),
  proteinPer100g: z.number().nonnegative().max(100),
  fatPer100g: z.number().nonnegative().max(100),
  carbsPer100g: z.number().nonnegative().max(100),
  fiberPer100g: z.number().nonnegative().max(100).optional(),
});

const foodSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    name: { type: "string" },
    brand: { type: "string", nullable: true },
    kcalPer100g: { type: "number" },
    proteinPer100g: { type: "number" },
    fatPer100g: { type: "number" },
    carbsPer100g: { type: "number" },
    fiberPer100g: { type: "number", nullable: true },
    isVerified: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
  },
} as const;

export const foodsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /v1/foods/search
   * Busca alimentos por nombre o marca (ILIKE, máx. 30 resultados).
   */
  app.get("/v1/foods/search", {
    schema: {
      tags: ["foods"],
      summary: "Buscar alimentos por nombre o marca",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        required: ["q"],
        properties: {
          q: { type: "string", minLength: 1 },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            items: { type: "array", items: foodSchema },
            total: { type: "integer" },
          },
        },
      },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const { q, limit = 20 } = req.query as { q: string; limit?: number };
    const pattern = `%${q}%`;

    const items = await db.query.foods.findMany({
      where: or(
        ilike(schema.foods.name, pattern),
        ilike(schema.foods.brand, pattern),
      ),
      limit: Math.min(Number(limit), 50),
      orderBy: (f, { asc }) => [asc(f.name)],
    });

    return reply.send({ items, total: items.length });
  });

  /**
   * GET /v1/foods/:id
   * Obtiene un alimento por ID.
   */
  app.get("/v1/foods/:id", {
    schema: {
      tags: ["foods"],
      summary: "Obtener alimento por ID",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
      response: { 200: foodSchema },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const food = await db.query.foods.findFirst({
      where: (f, { eq }) => eq(f.id, id),
    });
    if (!food) return reply.status(404).send({ error: "food_not_found" });
    return reply.send(food);
  });

  /**
   * POST /v1/foods
   * Añade un nuevo alimento al catálogo.
   */
  app.post("/v1/foods", {
    schema: {
      tags: ["foods"],
      summary: "Añadir alimento al catálogo",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["name", "kcalPer100g", "proteinPer100g", "fatPer100g", "carbsPer100g"],
        properties: {
          name: { type: "string", minLength: 2, maxLength: 120 },
          brand: { type: "string", maxLength: 80 },
          kcalPer100g: { type: "number", minimum: 0 },
          proteinPer100g: { type: "number", minimum: 0, maximum: 100 },
          fatPer100g: { type: "number", minimum: 0, maximum: 100 },
          carbsPer100g: { type: "number", minimum: 0, maximum: 100 },
          fiberPer100g: { type: "number", minimum: 0, maximum: 100 },
        },
      },
      response: { 201: foodSchema },
    },
    preHandler: app.authenticate,
  }, async (req, reply) => {
    const body = CreateFoodBody.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: "invalid_input", details: body.error.flatten() });
    }

    const [food] = await db
      .insert(schema.foods)
      .values({
        ...body.data,
        kcalPer100g: String(body.data.kcalPer100g),
        proteinPer100g: String(body.data.proteinPer100g),
        fatPer100g: String(body.data.fatPer100g),
        carbsPer100g: String(body.data.carbsPer100g),
        fiberPer100g: body.data.fiberPer100g != null ? String(body.data.fiberPer100g) : undefined,
        createdBy: req.user.sub,
      })
      .returning();

    return reply.status(201).send(food);
  });
};
