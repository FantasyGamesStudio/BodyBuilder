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

async function setupUser() {
  const app = await getTestApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email: "meals@bodybuilder.dev", password: "password123", nickname: "MealTester" },
  });
  return { app, token: res.json().access_token as string };
}

async function createFood(token: string, overrides = {}) {
  const app = await getTestApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/foods",
    headers: { Authorization: `Bearer ${token}` },
    payload: {
      name: "Pechuga de pollo",
      kcalPer100g: 165,
      proteinPer100g: 31,
      fatPer100g: 3.6,
      carbsPer100g: 0,
      ...overrides,
    },
  });
  return res.json() as { id: string; name: string };
}

async function logMeal(token: string, foodId: string, overrides = {}) {
  const app = await getTestApp();
  return app.inject({
    method: "POST",
    url: "/v1/meals",
    headers: { Authorization: `Bearer ${token}` },
    payload: {
      foodId,
      nutritionDate: "2026-04-15",
      mealSlot: "lunch",
      quantityG: 200,
      ...overrides,
    },
  });
}

// ─── Foods ───────────────────────────────────────────────────────────────────

describe("POST /v1/foods", () => {
  it("crea un alimento y devuelve sus datos con ID", async () => {
    const { token } = await setupUser();
    const app = await getTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/foods",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        name: "Arroz blanco",
        brand: "Hacendado",
        kcalPer100g: 130,
        proteinPer100g: 2.7,
        fatPer100g: 0.3,
        carbsPer100g: 28,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeTruthy();
    expect(body.name).toBe("Arroz blanco");
    expect(body.brand).toBe("Hacendado");
    expect(body.isVerified).toBe(false);
  });

  it("devuelve 401 sin token", async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/foods",
      payload: { name: "Test", kcalPer100g: 100, proteinPer100g: 5, fatPer100g: 2, carbsPer100g: 15 },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/foods/search", () => {
  it("encuentra alimentos por nombre parcial", async () => {
    const { token } = await setupUser();
    await createFood(token, { name: "Pechuga de pollo cocida" });
    await createFood(token, { name: "Pechuga de pavo" });
    await createFood(token, { name: "Ternera magra" });

    const app = await getTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/foods/search",
      headers: { Authorization: `Bearer ${token}` },
      query: { q: "pechuga" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(2);
    expect(body.items.every((f: { name: string }) => f.name.toLowerCase().includes("pechuga"))).toBe(true);
  });

  it("busca también por marca", async () => {
    const { token } = await setupUser();
    await createFood(token, { name: "Arroz", brand: "Brillante" });

    const app = await getTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/foods/search",
      headers: { Authorization: `Bearer ${token}` },
      query: { q: "brillante" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
  });

  it("devuelve array vacío si no hay coincidencias", async () => {
    const { token } = await setupUser();
    const app = await getTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/foods/search",
      headers: { Authorization: `Bearer ${token}` },
      query: { q: "xyz-inexistente-123" },
    });
    expect(res.json().items).toHaveLength(0);
  });
});

// ─── Log meals ────────────────────────────────────────────────────────────────

describe("POST /v1/meals", () => {
  it("registra una comida y calcula los macros correctamente", async () => {
    const { token } = await setupUser();
    const food = await createFood(token);

    const res = await logMeal(token, food.id, { quantityG: 200 });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    // 165 kcal/100g × 2 = 330
    expect(body.kcal).toBe(330);
    // 31 g proteína/100g × 2 = 62
    expect(body.proteinG).toBe(62);
    expect(body.food.name).toBe("Pechuga de pollo");
  });

  it("devuelve 404 si el foodId no existe", async () => {
    const { app, token } = await setupUser();
    const res = await app.inject({
      method: "POST",
      url: "/v1/meals",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        foodId: "00000000-0000-0000-0000-000000000000",
        nutritionDate: "2026-04-15",
        mealSlot: "lunch",
        quantityG: 100,
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it("devuelve 400 con fecha en formato incorrecto", async () => {
    const { token } = await setupUser();
    const food = await createFood(token);
    const res = await logMeal(token, food.id, { nutritionDate: "15-04-2026" });
    expect(res.statusCode).toBe(400);
  });
});

describe("PATCH /v1/meals/:id", () => {
  it("recalcula los macros al cambiar la cantidad", async () => {
    const { app, token } = await setupUser();
    const food = await createFood(token);
    const entry = (await logMeal(token, food.id, { quantityG: 100 })).json();

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meals/${entry.id}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { quantityG: 300 },
    });

    expect(res.statusCode).toBe(200);
    // 165 × 3 = 495
    expect(res.json().kcal).toBe(495);
    expect(res.json().quantityG).toBe(300);
  });

  it("actualiza el slot sin cambiar los macros", async () => {
    const { app, token } = await setupUser();
    const food = await createFood(token);
    const entry = (await logMeal(token, food.id)).json();

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meals/${entry.id}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { mealSlot: "dinner" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().mealSlot).toBe("dinner");
    expect(res.json().kcal).toBe(entry.kcal); // sin cambios
  });

  it("devuelve 404 si la entrada no pertenece al usuario", async () => {
    const { token: token1 } = await setupUser();
    const food = await createFood(token1);
    const entry = (await logMeal(token1, food.id)).json();

    // Segundo usuario
    const app = await getTestApp();
    const reg2 = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "other@bodybuilder.dev", password: "password123", nickname: "Other" },
    });
    const token2 = reg2.json().access_token;

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meals/${entry.id}`,
      headers: { Authorization: `Bearer ${token2}` },
      payload: { quantityG: 50 },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /v1/meals/:id", () => {
  it("elimina la entrada y devuelve { ok: true }", async () => {
    const { app, token } = await setupUser();
    const food = await createFood(token);
    const entry = (await logMeal(token, food.id)).json();

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/meals/${entry.id}`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("devuelve 404 al eliminar una entrada ya borrada", async () => {
    const { app, token } = await setupUser();
    const food = await createFood(token);
    const entry = (await logMeal(token, food.id)).json();

    await app.inject({ method: "DELETE", url: `/v1/meals/${entry.id}`, headers: { Authorization: `Bearer ${token}` } });

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/meals/${entry.id}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /v1/meals/day/:date", () => {
  it("devuelve las entradas del día agrupadas por slot", async () => {
    const { app, token } = await setupUser();
    const food = await createFood(token);

    await logMeal(token, food.id, { mealSlot: "breakfast", quantityG: 100 });
    await logMeal(token, food.id, { mealSlot: "lunch", quantityG: 150 });
    await logMeal(token, food.id, { mealSlot: "lunch", quantityG: 100 });

    const res = await app.inject({
      method: "GET",
      url: "/v1/meals/day/2026-04-15",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries).toHaveLength(3);
    expect(body.bySlot.breakfast).toHaveLength(1);
    expect(body.bySlot.lunch).toHaveLength(2);
    expect(body.bySlot.dinner).toHaveLength(0);
  });

  it("calcula los totales del día correctamente", async () => {
    const { app, token } = await setupUser();
    const food = await createFood(token);

    // 200 g × 165 kcal/100g = 330 kcal
    await logMeal(token, food.id, { quantityG: 200 });
    // 100 g × 165 kcal/100g = 165 kcal
    await logMeal(token, food.id, { quantityG: 100 });

    const res = await app.inject({
      method: "GET",
      url: "/v1/meals/day/2026-04-15",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.json().progress?.totals.kcal ?? res.json().entries.reduce((s: number, e: { kcal: number }) => s + e.kcal, 0)).toBe(495);
  });

  it("incluye progreso contra target si el usuario ha hecho onboarding", async () => {
    const { app, token } = await setupUser();

    await app.inject({
      method: "POST",
      url: "/v1/onboarding",
      headers: { Authorization: `Bearer ${token}` },
      payload: { weightKg: 80, heightCm: 178, ageYears: 30, sex: "m", activityLevel: "moderately_active", goalMode: "mantenimiento" },
    });

    const food = await createFood(token);
    await logMeal(token, food.id, { quantityG: 200 });

    const res = await app.inject({
      method: "GET",
      url: "/v1/meals/day/2026-04-15",
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = res.json();
    expect(body.progress).not.toBeNull();
    expect(body.progress.kcalStatus).toMatch(/green|yellow|red/);
    expect(typeof body.progress.kcalPct).toBe("number");
  });

  it("devuelve progress: null si no hay target activo", async () => {
    const { app, token } = await setupUser();
    const food = await createFood(token);
    await logMeal(token, food.id);

    const res = await app.inject({
      method: "GET",
      url: "/v1/meals/day/2026-04-15",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.json().progress).toBeNull();
  });

  it("devuelve 400 con formato de fecha inválido", async () => {
    const { app, token } = await setupUser();
    const res = await app.inject({
      method: "GET",
      url: "/v1/meals/day/15-04-2026",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("no mezcla datos de otro usuario", async () => {
    const { token: t1 } = await setupUser();
    const food = await createFood(t1);
    await logMeal(t1, food.id);

    const app = await getTestApp();
    const reg2 = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "other2@bodybuilder.dev", password: "password123", nickname: "Other2" },
    });
    const t2 = reg2.json().access_token;

    const res = await app.inject({
      method: "GET",
      url: "/v1/meals/day/2026-04-15",
      headers: { Authorization: `Bearer ${t2}` },
    });

    expect(res.json().entries).toHaveLength(0);
  });
});

// ─── Week summary ─────────────────────────────────────────────────────────────

// Semana de prueba: lunes 13 abr → domingo 19 abr 2026
const WEEK_START = "2026-04-13";
const WEEK_END = "2026-04-19";

describe("GET /v1/meals/week/:weekStart", () => {
  it("devuelve 7 días con estructura correcta", async () => {
    const { app, token } = await setupUser();
    const food = await createFood(token);

    // Registrar comidas en dos días distintos de la semana
    await logMeal(token, food.id, { nutritionDate: "2026-04-14", mealSlot: "breakfast", quantityG: 100 });
    await logMeal(token, food.id, { nutritionDate: "2026-04-15", mealSlot: "lunch", quantityG: 200 });

    const res = await app.inject({
      method: "GET",
      url: `/v1/meals/week/${WEEK_START}`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.weekStart).toBe(WEEK_START);
    expect(body.weekEnd).toBe(WEEK_END);
    expect(body.days).toHaveLength(7);
    expect(body.days[0].date).toBe(WEEK_START);
    expect(body.days[6].date).toBe(WEEK_END);
  });

  it("marca correctamente los días con y sin registros", async () => {
    const { app, token } = await setupUser();
    const food = await createFood(token);

    await logMeal(token, food.id, { nutritionDate: "2026-04-14", quantityG: 100 });

    const res = await app.inject({
      method: "GET",
      url: `/v1/meals/week/${WEEK_START}`,
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = res.json();
    // Lunes (índice 0): sin datos
    expect(body.days[0].hasData).toBe(false);
    // Martes (índice 1): con datos
    expect(body.days[1].hasData).toBe(true);
  });

  it("acumula los totales semanales correctamente", async () => {
    const app = await getTestApp();
    const unique = `week-totals-${Date.now()}@bodybuilder.dev`;
    const regRes = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: unique, password: "password123", nickname: "WeekTester" },
    });
    expect(regRes.statusCode).toBe(201);
    const token = regRes.json().access_token as string;
    expect(token).toBeTruthy();

    const foodRes = await app.inject({
      method: "POST",
      url: "/v1/foods",
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: "Pechuga test", kcalPer100g: 165, proteinPer100g: 31, fatPer100g: 3.6, carbsPer100g: 0 },
    });
    expect(foodRes.statusCode).toBe(201);
    const foodId = foodRes.json().id as string;

    // 200 g × 165 kcal/100g = 330 kcal
    await app.inject({
      method: "POST",
      url: "/v1/meals",
      headers: { Authorization: `Bearer ${token}` },
      payload: { foodId, nutritionDate: "2026-04-14", mealSlot: "lunch", quantityG: 200 },
    });
    // 100 g × 165 kcal/100g = 165 kcal
    await app.inject({
      method: "POST",
      url: "/v1/meals",
      headers: { Authorization: `Bearer ${token}` },
      payload: { foodId, nutritionDate: "2026-04-15", mealSlot: "lunch", quantityG: 100 },
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/meals/week/${WEEK_START}`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.json().weekTotals.kcal).toBe(495);
  });

  it("incluye target y progress por día si el usuario ha hecho onboarding", async () => {
    const { app, token } = await setupUser();

    await app.inject({
      method: "POST",
      url: "/v1/onboarding",
      headers: { Authorization: `Bearer ${token}` },
      payload: { weightKg: 80, heightCm: 178, ageYears: 30, sex: "m", activityLevel: "moderately_active", goalMode: "mantenimiento" },
    });

    const food = await createFood(token);
    await logMeal(token, food.id, { nutritionDate: "2026-04-14", quantityG: 200 });

    const res = await app.inject({
      method: "GET",
      url: `/v1/meals/week/${WEEK_START}`,
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = res.json();
    expect(body.target).not.toBeNull();
    expect(body.target.kcalTarget).toBeGreaterThan(0);
    // El día con datos tiene progress
    expect(body.days[1].progress).not.toBeNull();
    expect(body.days[1].progress.kcalStatus).toMatch(/green|yellow|red/);
    // El día sin datos tiene progress con totales a 0
    expect(body.days[0].progress).not.toBeNull();
    expect(body.days[0].progress.totals.kcal).toBe(0);
  });

  it("devuelve target: null si no hay onboarding y progress: null por día", async () => {
    const { app, token } = await setupUser();
    const food = await createFood(token);
    await logMeal(token, food.id, { nutritionDate: "2026-04-14", quantityG: 100 });

    const res = await app.inject({
      method: "GET",
      url: `/v1/meals/week/${WEEK_START}`,
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = res.json();
    expect(body.target).toBeNull();
    expect(body.days.every((d: { progress: unknown }) => d.progress === null)).toBe(true);
  });

  it("devuelve 400 si weekStart no es lunes", async () => {
    const { app, token } = await setupUser();
    const res = await app.inject({
      method: "GET",
      url: "/v1/meals/week/2026-04-15", // miércoles
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("week_start_must_be_monday");
  });

  it("devuelve 400 con formato de fecha inválido", async () => {
    const { app, token } = await setupUser();
    const res = await app.inject({
      method: "GET",
      url: "/v1/meals/week/13-04-2026",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("devuelve 401 sin token", async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/meals/week/${WEEK_START}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("no mezcla datos de otro usuario", async () => {
    const { token: t1 } = await setupUser();
    const food = await createFood(t1);
    await logMeal(t1, food.id, { nutritionDate: "2026-04-14", quantityG: 200 });

    const app = await getTestApp();
    const reg2 = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "week-other@bodybuilder.dev", password: "password123", nickname: "WeekOther" },
    });
    const t2 = reg2.json().access_token;

    const res = await app.inject({
      method: "GET",
      url: `/v1/meals/week/${WEEK_START}`,
      headers: { Authorization: `Bearer ${t2}` },
    });

    const body = res.json();
    expect(body.days.every((d: { hasData: boolean }) => !d.hasData)).toBe(true);
    expect(body.weekTotals.kcal).toBe(0);
  });
});
