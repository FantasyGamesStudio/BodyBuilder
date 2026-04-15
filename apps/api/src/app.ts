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
  await app.register(advisorRoutes);

  return app;
}
