import cors from "@fastify/cors";
import Fastify from "fastify";
import authPlugin from "./plugins/auth.js";
import swaggerPlugin from "./plugins/swagger.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { meRoutes } from "./routes/me.js";
import { foodsRoutes } from "./routes/foods.js";
import { mealsRoutes } from "./routes/meals.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { advisorRoutes } from "./routes/advisor.js";
import { workoutsRoutes } from "./routes/workouts.js";
import { weightRoutes } from "./routes/weight.js";
import { h2MealsRoutes } from "./routes/h2-meals.js";
import { coachingRoutes } from "./routes/coaching.js";
import { createNutritionWorker } from "./workers/nutrition.js";
import { createPurgeWorker } from "./workers/purge.js";

export async function buildApp() {
  const app = Fastify({ logger: true });

  // ── Cross-cutting plugins ────────────────────────────────────────────────
  await app.register(cors, {
    origin: "*",
    strictPreflight: false,
  });
  // swagger debe registrarse antes de las rutas
  await app.register(swaggerPlugin);
  await app.register(authPlugin);

  // ── Routes ───────────────────────────────────────────────────────────────
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(meRoutes);
  await app.register(onboardingRoutes);
  await app.register(foodsRoutes);
  await app.register(mealsRoutes);
  await app.register(workoutsRoutes);
  await app.register(weightRoutes);
  await app.register(advisorRoutes);
  await app.register(h2MealsRoutes);
  await app.register(coachingRoutes);

  // ── Workers (solo si no estamos en modo test) ──────────────────────────────
  if (process.env.NODE_ENV !== "test") {
    createNutritionWorker();
    createPurgeWorker();
  }

  return app;
}
