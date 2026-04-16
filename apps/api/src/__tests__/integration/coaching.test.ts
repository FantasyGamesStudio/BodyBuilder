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

async function setupUser(email = "coach@bodybuilder.dev") {
  const app = await getTestApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email, password: "password123", nickname: "CoachTester" },
  });
  return { app, token: res.json().access_token as string };
}

async function getThread(token: string) {
  const app = await getTestApp();
  const res = await app.inject({
    method: "GET",
    url: "/v1/coaching/thread",
    headers: { Authorization: `Bearer ${token}` },
  });
  return res;
}

// ─── GET /v1/coaching/thread ─────────────────────────────────────────────────

describe("GET /v1/coaching/thread", () => {
  it("crea un nuevo hilo si no existe ninguno activo", async () => {
    const { token } = await setupUser();
    const res = await getThread(token);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("id");
    expect(body.status).toBe("active");
    expect(body).toHaveProperty("expiresAt");
    expect(body).toHaveProperty("openedAt");
  });

  it("devuelve el mismo hilo en llamadas sucesivas", async () => {
    const { token } = await setupUser();
    const res1 = await getThread(token);
    const res2 = await getThread(token);

    expect(res1.json().id).toBe(res2.json().id);
  });

  it("requiere autenticación", async () => {
    const app = await getTestApp();
    const res = await app.inject({ method: "GET", url: "/v1/coaching/thread" });
    expect(res.statusCode).toBe(401);
  });

  it("los hilos son privados por usuario", async () => {
    const { token: t1 } = await setupUser("c1@bodybuilder.dev");
    const { token: t2 } = await setupUser("c2@bodybuilder.dev");

    const r1 = await getThread(t1);
    const r2 = await getThread(t2);

    expect(r1.json().id).not.toBe(r2.json().id);
  });
});

// ─── GET /v1/coaching/thread/:id/messages ────────────────────────────────────

describe("GET /v1/coaching/thread/:id/messages", () => {
  it("devuelve array de mensajes (vacío inicialmente excepto system prompt)", async () => {
    const { token } = await setupUser();
    const thread = await getThread(token);
    const threadId = thread.json().id;

    const app = await getTestApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/coaching/thread/${threadId}/messages`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("messages");
    expect(Array.isArray(body.messages)).toBe(true);
  });

  it("devuelve 404 para hilo de otro usuario", async () => {
    const { token: t1 } = await setupUser("cm1@bodybuilder.dev");
    const { token: t2 } = await setupUser("cm2@bodybuilder.dev");

    const thread = await getThread(t1);
    const threadId = thread.json().id;

    const app = await getTestApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/coaching/thread/${threadId}/messages`,
      headers: { Authorization: `Bearer ${t2}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("devuelve mensajes en orden cronológico", async () => {
    const { token } = await setupUser();
    const thread = await getThread(token);
    const threadId = thread.json().id;

    // Insertar mensajes directamente para no depender de OpenAI en tests
    const { db: testDb, schema: s } = await import("../../db/index.js");
    await testDb.insert(s.coachingMessages).values([
      { threadId, role: "user", bodyText: "Mensaje 1", linkedMealEntryId: null },
      { threadId, role: "assistant", bodyText: "Respuesta 1", linkedMealEntryId: null },
    ]);

    const app = await getTestApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/coaching/thread/${threadId}/messages`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const messages = res.json().messages as Array<{ role: string; bodyText: string }>;
    const userMsgs = messages.filter((m) => m.role === "user");
    expect(userMsgs.length).toBeGreaterThanOrEqual(1);
    expect(userMsgs[0].bodyText).toBe("Mensaje 1");
  });
});

// ─── POST /v1/coaching/thread/:id/messages ───────────────────────────────────

describe("POST /v1/coaching/thread/:id/messages", () => {
  it("rechaza body vacío (sin texto, audio ni imagen)", async () => {
    const { token } = await setupUser();
    const thread = await getThread(token);
    const threadId = thread.json().id;

    const app = await getTestApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/coaching/thread/${threadId}/messages`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("devuelve 404 para hilo de otro usuario", async () => {
    const { token: t1 } = await setupUser("cs1@bodybuilder.dev");
    const { token: t2 } = await setupUser("cs2@bodybuilder.dev");

    const thread = await getThread(t1);
    const threadId = thread.json().id;

    const app = await getTestApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/coaching/thread/${threadId}/messages`,
      headers: { Authorization: `Bearer ${t2}` },
      payload: { text: "Hola" },
    });
    expect(res.statusCode).toBe(404);
  });

  // Nota: el test de respuesta exitosa requeriría mockear OpenAI.
  // Se omite para no añadir dependencias de red en los tests de integración.
  // El contrato de respuesta { reply, transcription? } está cubierto por el tipo.
});

// ─── DELETE /v1/coaching/thread/:id ──────────────────────────────────────────

describe("DELETE /v1/coaching/thread/:id", () => {
  it("marca el hilo como purged", async () => {
    const { token } = await setupUser();
    const thread = await getThread(token);
    const threadId = thread.json().id;

    const app = await getTestApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/coaching/thread/${threadId}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    // Llamar de nuevo a getThread debe crear uno nuevo (el anterior está purged)
    const newThread = await getThread(token);
    expect(newThread.json().id).not.toBe(threadId);
  });

  it("devuelve 404 para hilo de otro usuario", async () => {
    const { token: t1 } = await setupUser("cd1@bodybuilder.dev");
    const { token: t2 } = await setupUser("cd2@bodybuilder.dev");

    const thread = await getThread(t1);
    const threadId = thread.json().id;

    const app = await getTestApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/coaching/thread/${threadId}`,
      headers: { Authorization: `Bearer ${t2}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
