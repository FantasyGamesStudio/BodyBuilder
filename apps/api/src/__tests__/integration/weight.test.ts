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

async function setupUser() {
  const app = await getTestApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email: "weight@bodybuilder.dev", password: "password123", nickname: "WeightTester" },
  });
  return { app, token: res.json().access_token as string };
}

describe("POST /v1/weight", () => {
  it("registra el peso del día", async () => {
    const { app, token } = await setupUser();
    const res = await app.inject({
      method: "POST",
      url: "/v1/weight",
      headers: { Authorization: `Bearer ${token}` },
      payload: { logDate: "2026-04-16", weightKg: 78.5 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.weightKg).toBe(78.5);
    expect(body.logDate).toBe("2026-04-16");
  });

  it("actualiza el registro si ya existe uno para esa fecha (upsert)", async () => {
    const { app, token } = await setupUser();
    await app.inject({
      method: "POST",
      url: "/v1/weight",
      headers: { Authorization: `Bearer ${token}` },
      payload: { logDate: "2026-04-16", weightKg: 78.5 },
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/weight",
      headers: { Authorization: `Bearer ${token}` },
      payload: { logDate: "2026-04-16", weightKg: 79.0, notes: "Tras desayuno" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().weightKg).toBe(79.0);
    expect(res.json().notes).toBe("Tras desayuno");
  });

  it("rechaza pesos fuera de rango", async () => {
    const { app, token } = await setupUser();
    const res = await app.inject({
      method: "POST",
      url: "/v1/weight",
      headers: { Authorization: `Bearer ${token}` },
      payload: { logDate: "2026-04-16", weightKg: 10 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("requiere autenticación", async () => {
    const { app } = await setupUser();
    const res = await app.inject({
      method: "POST",
      url: "/v1/weight",
      payload: { logDate: "2026-04-16", weightKg: 78.5 },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/weight", () => {
  it("devuelve el historial en el rango solicitado", async () => {
    const { app, token } = await setupUser();
    await app.inject({
      method: "POST", url: "/v1/weight",
      headers: { Authorization: `Bearer ${token}` },
      payload: { logDate: "2026-04-14", weightKg: 78.0 },
    });
    await app.inject({
      method: "POST", url: "/v1/weight",
      headers: { Authorization: `Bearer ${token}` },
      payload: { logDate: "2026-04-15", weightKg: 77.8 },
    });
    await app.inject({
      method: "POST", url: "/v1/weight",
      headers: { Authorization: `Bearer ${token}` },
      payload: { logDate: "2026-04-16", weightKg: 77.5 },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/weight?from=2026-04-14&to=2026-04-16",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const { entries } = res.json() as { entries: Array<{ logDate: string; weightKg: number }> };
    expect(entries).toHaveLength(3);
    expect(entries[0].logDate).toBe("2026-04-14");
    expect(entries[2].weightKg).toBe(77.5);
  });

  it("no devuelve registros fuera del rango", async () => {
    const { app, token } = await setupUser();
    await app.inject({
      method: "POST", url: "/v1/weight",
      headers: { Authorization: `Bearer ${token}` },
      payload: { logDate: "2026-03-01", weightKg: 80.0 },
    });
    const res = await app.inject({
      method: "GET",
      url: "/v1/weight?from=2026-04-01&to=2026-04-30",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().entries).toHaveLength(0);
  });
});

describe("DELETE /v1/weight/:id", () => {
  it("elimina el registro del usuario", async () => {
    const { app, token } = await setupUser();
    const created = await app.inject({
      method: "POST", url: "/v1/weight",
      headers: { Authorization: `Bearer ${token}` },
      payload: { logDate: "2026-04-16", weightKg: 78.5 },
    });
    const id = created.json().id as string;

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/weight/${id}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("no puede borrar un registro de otro usuario", async () => {
    const { app, token: token1 } = await setupUser();
    // Segundo usuario en la misma instancia de app
    const reg2 = await app.inject({
      method: "POST", url: "/v1/auth/register",
      payload: { email: "weight2@bodybuilder.dev", password: "password123", nickname: "W2" },
    });
    const token2 = reg2.json().access_token as string;

    const created = await app.inject({
      method: "POST", url: "/v1/weight",
      headers: { Authorization: `Bearer ${token1}` },
      payload: { logDate: "2026-04-16", weightKg: 78.5 },
    });
    const id = created.json().id as string;

    const del = await app.inject({
      method: "DELETE",
      url: `/v1/weight/${id}`,
      headers: { Authorization: `Bearer ${token2}` },
    });
    expect(del.statusCode).toBe(404);
  });
});
