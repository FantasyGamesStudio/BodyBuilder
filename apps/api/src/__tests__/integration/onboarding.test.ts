import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestApp, getTestApp } from "../helpers/app.js";
import { closeTestDb, resetDb } from "../helpers/db.js";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closeTestApp();
  await closeTestDb();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createAuthenticatedUser() {
  const app = await getTestApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      email: "user@bodybuilder.dev",
      password: "password123",
      nickname: "Tester",
    },
  });
  const { access_token } = res.json();
  return { app, token: access_token as string };
}

const VALID_ONBOARDING = {
  weightKg: 80,
  heightCm: 178,
  ageYears: 30,
  sex: "m",
  activityLevel: "moderately_active",
  goalMode: "volumen_limpio",
};

// ─── GET /v1/onboarding/suggestion ───────────────────────────────────────────

describe("GET /v1/onboarding/suggestion", () => {
  it("devuelve bmr, tdee, kcalTarget y macros sin persistir nada", async () => {
    const { app, token } = await createAuthenticatedUser();
    const res = await app.inject({
      method: "GET",
      url: "/v1/onboarding/suggestion",
      headers: { Authorization: `Bearer ${token}` },
      query: VALID_ONBOARDING as unknown as Record<string, string>,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.bmr).toBeGreaterThan(0);
    expect(body.tdee).toBeGreaterThan(body.bmr);
    expect(body.kcalTarget).toBe(body.tdee + 300); // volumen_limpio = +300
    expect(body.proteinMinG).toBe(Math.round(80 * 2.2));
    expect(body.kcalRangeMin).toBeLessThan(body.kcalTarget);
    expect(body.kcalRangeMax).toBeGreaterThan(body.kcalTarget);
  });

  it("devuelve 401 sin token", async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/onboarding/suggestion",
      query: VALID_ONBOARDING as unknown as Record<string, string>,
    });
    expect(res.statusCode).toBe(401);
  });

  it("devuelve 400 si faltan parámetros requeridos", async () => {
    const { app, token } = await createAuthenticatedUser();
    const res = await app.inject({
      method: "GET",
      url: "/v1/onboarding/suggestion",
      headers: { Authorization: `Bearer ${token}` },
      query: { weightKg: "80" }, // faltan heightCm, ageYears, sex, activityLevel, goalMode
    });
    expect(res.statusCode).toBe(400);
  });

  it("kcalTarget de mantenimiento = tdee exacto", async () => {
    const { app, token } = await createAuthenticatedUser();
    const res = await app.inject({
      method: "GET",
      url: "/v1/onboarding/suggestion",
      headers: { Authorization: `Bearer ${token}` },
      query: { ...VALID_ONBOARDING, goalMode: "mantenimiento" } as unknown as Record<string, string>,
    });
    const body = res.json();
    expect(body.kcalTarget).toBe(body.tdee);
  });
});

// ─── POST /v1/onboarding ─────────────────────────────────────────────────────

describe("POST /v1/onboarding", () => {
  it("persiste el onboarding y devuelve IDs + sugerencia calculada", async () => {
    const { app, token } = await createAuthenticatedUser();
    const res = await app.inject({
      method: "POST",
      url: "/v1/onboarding",
      headers: { Authorization: `Bearer ${token}` },
      payload: VALID_ONBOARDING,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.onboardingId).toBeTruthy();
    expect(body.targetSetId).toBeTruthy();
    expect(body.suggestion.kcalTarget).toBeGreaterThan(0);
  });

  it("marca el perfil del usuario como onboardingCompleted = true", async () => {
    const { app, token } = await createAuthenticatedUser();

    // Antes del onboarding
    const before = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(before.json().profile.onboardingCompleted).toBe(false);

    // Completar onboarding
    await app.inject({
      method: "POST",
      url: "/v1/onboarding",
      headers: { Authorization: `Bearer ${token}` },
      payload: VALID_ONBOARDING,
    });

    // Después
    const after = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(after.json().profile.onboardingCompleted).toBe(true);
  });

  it("al hacer un segundo onboarding, desactiva el target anterior", async () => {
    const { app, token } = await createAuthenticatedUser();

    // Primer onboarding
    await app.inject({
      method: "POST",
      url: "/v1/onboarding",
      headers: { Authorization: `Bearer ${token}` },
      payload: VALID_ONBOARDING,
    });

    // Segundo onboarding con distinto objetivo
    await app.inject({
      method: "POST",
      url: "/v1/onboarding",
      headers: { Authorization: `Bearer ${token}` },
      payload: { ...VALID_ONBOARDING, goalMode: "definicion" },
    });

    // Solo debe haber un target activo
    const targetRes = await app.inject({
      method: "GET",
      url: "/v1/onboarding/active-target",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(targetRes.statusCode).toBe(200);
    expect(targetRes.json().goalMode).toBe("definicion");
  });

  it("usa los pasos NEAT sugeridos si el usuario no los confirma", async () => {
    const { app, token } = await createAuthenticatedUser();
    const suggRes = await app.inject({
      method: "GET",
      url: "/v1/onboarding/suggestion",
      headers: { Authorization: `Bearer ${token}` },
      query: VALID_ONBOARDING as unknown as Record<string, string>,
    });
    const suggestedSteps = suggRes.json().neatSuggestedSteps;

    await app.inject({
      method: "POST",
      url: "/v1/onboarding",
      headers: { Authorization: `Bearer ${token}` },
      payload: VALID_ONBOARDING, // sin neatFloorSteps
    });

    const targetRes = await app.inject({
      method: "GET",
      url: "/v1/onboarding/active-target",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(targetRes.json().neatFloorSteps).toBe(suggestedSteps);
  });

  it("devuelve 400 con datos físicos inválidos (peso negativo)", async () => {
    const { app, token } = await createAuthenticatedUser();
    const res = await app.inject({
      method: "POST",
      url: "/v1/onboarding",
      headers: { Authorization: `Bearer ${token}` },
      payload: { ...VALID_ONBOARDING, weightKg: -10 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("devuelve 401 sin token", async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/onboarding",
      payload: VALID_ONBOARDING,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ─── GET /v1/onboarding/active-target ────────────────────────────────────────

describe("GET /v1/onboarding/active-target", () => {
  it("devuelve 404 si el usuario no ha hecho onboarding", async () => {
    const { app, token } = await createAuthenticatedUser();
    const res = await app.inject({
      method: "GET",
      url: "/v1/onboarding/active-target",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("devuelve el target activo con rangos kcal calculados", async () => {
    const { app, token } = await createAuthenticatedUser();
    await app.inject({
      method: "POST",
      url: "/v1/onboarding",
      headers: { Authorization: `Bearer ${token}` },
      payload: VALID_ONBOARDING,
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/onboarding/active-target",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kcalTarget).toBeGreaterThan(0);
    expect(body.kcalRangeMin).toBeLessThan(body.kcalTarget);
    expect(body.kcalRangeMax).toBeGreaterThan(body.kcalTarget);
    expect(body.goalMode).toBe("volumen_limpio");
    expect(body.weightKg).toBe(80);
  });
});
