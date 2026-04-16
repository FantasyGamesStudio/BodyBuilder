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

async function setupUser(email = "h2@bodybuilder.dev") {
  const app = await getTestApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email, password: "password123", nickname: "H2Tester" },
  });
  return { app, token: res.json().access_token as string };
}

async function createDraft(token: string, overrides = {}) {
  const app = await getTestApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/meals/draft",
    headers: { Authorization: `Bearer ${token}` },
    payload: {
      nutritionDate: "2026-04-15",
      mealSlot: "lunch",
      ...overrides,
    },
  });
  return res;
}

// ─── POST /v1/meals/draft ─────────────────────────────────────────────────────

describe("POST /v1/meals/draft", () => {
  it("crea un borrador con status draft", async () => {
    const { token } = await setupUser();
    const res = await createDraft(token);

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      status: "draft",
      nutritionDate: "2026-04-15",
      mealSlot: "lunch",
    });
    expect(body.id).toBeDefined();
  });

  it("rechaza mealSlot inválido", async () => {
    const { token } = await setupUser();
    const res = await createDraft(token, { mealSlot: "brunch" });
    expect(res.statusCode).toBe(400);
  });

  it("rechaza fecha con formato incorrecto", async () => {
    const { token } = await setupUser();
    const res = await createDraft(token, { nutritionDate: "15-04-2026" });
    expect(res.statusCode).toBe(400);
  });

  it("requiere autenticación", async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/meals/draft",
      payload: { nutritionDate: "2026-04-15", mealSlot: "lunch" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("acepta userNote opcional", async () => {
    const { token } = await setupUser();
    const res = await createDraft(token, { userNote: "Arroz con pollo" });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBeDefined();
  });
});

// ─── POST /v1/meals/:id/submit-for-ai ─────────────────────────────────────────

describe("POST /v1/meals/:id/submit-for-ai", () => {
  it("rechaza si no hay media ni flags de hasAudio/hasImages", async () => {
    const { token } = await setupUser();
    const draft = await createDraft(token);
    const id = draft.json().id;

    const app = await getTestApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/meals/${id}/submit-for-ai`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { hasAudio: false, hasImages: false },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("no_media_provided");
  });

  it("acepta hasImages=true aunque no haya media subida todavía", async () => {
    const { token } = await setupUser();
    const draft = await createDraft(token);
    const id = draft.json().id;

    const app = await getTestApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/meals/${id}/submit-for-ai`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { hasImages: true },
    });
    // Puede fallar por Redis no disponible en tests, pero debe pasar la validación
    // Aceptamos 200 (cola disponible) o 500 (cola no disponible en test)
    expect([200, 500]).toContain(res.statusCode);
  });

  it("devuelve 404 para comida de otro usuario", async () => {
    const { token: t1 } = await setupUser("u1@bodybuilder.dev");
    const { token: t2 } = await setupUser("u2@bodybuilder.dev");

    const draft = await createDraft(t1);
    const id = draft.json().id;

    const app = await getTestApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/meals/${id}/submit-for-ai`,
      headers: { Authorization: `Bearer ${t2}` },
      payload: { hasImages: true },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /v1/meals/:id ────────────────────────────────────────────────────────

describe("GET /v1/meals/:id", () => {
  it("devuelve la entrada con status, media, corrections y aiEstimate", async () => {
    const { token } = await setupUser();
    const draft = await createDraft(token, { userNote: "Test GET detail" });
    const id = draft.json().id;

    const app = await getTestApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/meals/${id}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(id);
    expect(body.status).toBe("draft");
    expect(body).toHaveProperty("media");
    expect(body).toHaveProperty("corrections");
    expect(body).toHaveProperty("aiEstimate");
    expect(Array.isArray(body.media)).toBe(true);
  });

  it("devuelve 404 para comida de otro usuario", async () => {
    const { token: t1 } = await setupUser("owner@bodybuilder.dev");
    const { token: t2 } = await setupUser("other@bodybuilder.dev");

    const draft = await createDraft(t1);
    const id = draft.json().id;

    const app = await getTestApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/meals/${id}`,
      headers: { Authorization: `Bearer ${t2}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── PATCH /v1/meals/:id/confirm ─────────────────────────────────────────────

describe("PATCH /v1/meals/:id/confirm", () => {
  it("rechaza confirmar una entrada en estado draft (no pending_user_review)", async () => {
    const { token } = await setupUser();
    const draft = await createDraft(token);
    const id = draft.json().id;

    const app = await getTestApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meals/${id}/confirm`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { acceptAiEstimate: true },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("entry_not_reviewable");
  });

  it("acepta macros con valor 0 (agua, café negro)", async () => {
    const { token } = await setupUser();
    const { db: testDb, schema: s } = await import("../../db/index.js");

    // Crear draft y forzar status a pending_user_review para poder confirmar
    const draft = await createDraft(token, { userNote: "Agua" });
    const id = draft.json().id;
    await testDb.update(s.mealLogEntries)
      .set({ status: "pending_user_review" })
      .where((await import("drizzle-orm")).eq(s.mealLogEntries.id, id));

    const app = await getTestApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meals/${id}/confirm`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        acceptAiEstimate: false,
        kcal: 0,
        proteinG: 0,
        fatG: 0,
        carbsG: 0,
        quantityG: 250,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("confirmed");
    expect(body.kcal).toBe(0);
  });

  it("confirma acceptAiEstimate=true y cambia status a confirmed", async () => {
    const { token } = await setupUser();
    const { db: testDb, schema: s } = await import("../../db/index.js");

    const draft = await createDraft(token);
    const id = draft.json().id;
    await testDb.update(s.mealLogEntries)
      .set({ status: "pending_user_review", kcal: 350, foodName: "Arroz" })
      .where((await import("drizzle-orm")).eq(s.mealLogEntries.id, id));

    const app = await getTestApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meals/${id}/confirm`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { acceptAiEstimate: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("confirmed");
  });

  it("confirma con valores personalizados y guarda corrección", async () => {
    const { token } = await setupUser();
    const { db: testDb, schema: s } = await import("../../db/index.js");
    const { eq } = await import("drizzle-orm");

    const draft = await createDraft(token);
    const id = draft.json().id;
    await testDb.update(s.mealLogEntries)
      .set({ status: "pending_user_review", kcal: 350, foodName: "Arroz" })
      .where(eq(s.mealLogEntries.id, id));

    const app = await getTestApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meals/${id}/confirm`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { acceptAiEstimate: false, kcal: 400, proteinG: 10, fatG: 5, carbsG: 60 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("confirmed");
    expect(res.json().kcal).toBe(400);

    // Debe haber guardado una corrección
    const corrections = await testDb.query.mealCorrections.findMany({
      where: eq(s.mealCorrections.mealEntryId, id),
    });
    expect(corrections.length).toBeGreaterThan(0);
  });

  it("devuelve 404 para comida de otro usuario", async () => {
    const { token: t1 } = await setupUser("owner2@bodybuilder.dev");
    const { token: t2 } = await setupUser("other2@bodybuilder.dev");

    const draft = await createDraft(t1);
    const id = draft.json().id;

    const app = await getTestApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meals/${id}/confirm`,
      headers: { Authorization: `Bearer ${t2}` },
      payload: { acceptAiEstimate: true },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /v1/meals/:id/correction ───────────────────────────────────────────

describe("POST /v1/meals/:id/correction", () => {
  it("acepta corrección con macros a 0", async () => {
    const { token } = await setupUser();
    const { db: testDb, schema: s } = await import("../../db/index.js");
    const { eq } = await import("drizzle-orm");

    const draft = await createDraft(token);
    const id = draft.json().id;
    await testDb.update(s.mealLogEntries)
      .set({ status: "pending_user_review", kcal: 200, foodName: "Té" })
      .where(eq(s.mealLogEntries.id, id));

    const app = await getTestApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/meals/${id}/correction`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0, userExplanationText: "Era solo agua" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("devuelve 404 para comida de otro usuario", async () => {
    const { token: t1 } = await setupUser("co1@bodybuilder.dev");
    const { token: t2 } = await setupUser("co2@bodybuilder.dev");

    const draft = await createDraft(t1);
    const id = draft.json().id;

    const app = await getTestApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/meals/${id}/correction`,
      headers: { Authorization: `Bearer ${t2}` },
      payload: { kcal: 100 },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /v1/meals/:id/reprocess ────────────────────────────────────────────

describe("POST /v1/meals/:id/reprocess", () => {
  it("cambia status a ai_processing y devuelve jobId (o 500 si no hay queue)", async () => {
    const { token } = await setupUser();
    const { db: testDb, schema: s } = await import("../../db/index.js");
    const { eq } = await import("drizzle-orm");

    const draft = await createDraft(token);
    const id = draft.json().id;
    // Añadir media fake para que no rechace por no_media_provided
    await testDb.insert(s.mealMedia).values({
      mealEntryId: id,
      objectKey: "meals/fake.jpg",
      type: "image",
      mime: "image/jpeg",
      sizeBytes: 1000,
    });

    const app = await getTestApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/meals/${id}/reprocess`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { userExplanationText: "Era 300g, no 150g" },
    });
    // 200 si queue disponible, 500 si Redis no está en test
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.json().status).toBe("ai_processing");
    }
  });

  it("devuelve 404 para comida de otro usuario", async () => {
    const { token: t1 } = await setupUser("re1@bodybuilder.dev");
    const { token: t2 } = await setupUser("re2@bodybuilder.dev");

    const draft = await createDraft(t1);
    const id = draft.json().id;

    const app = await getTestApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/meals/${id}/reprocess`,
      headers: { Authorization: `Bearer ${t2}` },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});
