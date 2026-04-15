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

const VALID_USER = {
  email: "test@bodybuilder.dev",
  password: "password123",
  nickname: "Tester",
};

async function registerUser(overrides?: Partial<typeof VALID_USER>) {
  const app = await getTestApp();
  return app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { ...VALID_USER, ...overrides },
  });
}

async function loginUser(email = VALID_USER.email, password = VALID_USER.password) {
  const app = await getTestApp();
  return app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email, password },
  });
}

// ─── Register ────────────────────────────────────────────────────────────────

describe("POST /v1/auth/register", () => {
  it("crea el usuario y devuelve access_token + refresh_token", async () => {
    const res = await registerUser();

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      token_type: "Bearer",
      expires_in: "15m",
    });
    expect(body.access_token).toBeTruthy();
    expect(body.refresh_token).toBeTruthy();
  });

  it("devuelve 409 si el email ya está registrado", async () => {
    await registerUser();
    const res = await registerUser();

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("email_taken");
  });

  it("trata el email como case-insensitive", async () => {
    await registerUser({ email: "Test@BodyBuilder.DEV" });
    const res = await registerUser({ email: "test@bodybuilder.dev" });

    expect(res.statusCode).toBe(409);
  });

  it("devuelve 400 si falta el campo email", async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { password: "password123", nickname: "Tester" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("devuelve 400 si la contraseña tiene menos de 8 caracteres", async () => {
    const res = await registerUser({ password: "short" });
    expect(res.statusCode).toBe(400);
  });

  it("devuelve 400 si el nickname tiene menos de 2 caracteres", async () => {
    const res = await registerUser({ nickname: "X" });
    expect(res.statusCode).toBe(400);
  });
});

// ─── Login ───────────────────────────────────────────────────────────────────

describe("POST /v1/auth/login", () => {
  beforeEach(async () => {
    await registerUser();
  });

  it("devuelve tokens con credenciales correctas", async () => {
    const res = await loginUser();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.access_token).toBeTruthy();
    expect(body.refresh_token).toBeTruthy();
  });

  it("devuelve 401 con contraseña incorrecta", async () => {
    const res = await loginUser(VALID_USER.email, "wrongpassword");
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("invalid_credentials");
  });

  it("devuelve 401 con email inexistente", async () => {
    const res = await loginUser("nobody@bodybuilder.dev", "password123");
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("invalid_credentials");
  });
});

// ─── Refresh ─────────────────────────────────────────────────────────────────

describe("POST /v1/auth/refresh", () => {
  it("rota el token y devuelve un nuevo par de tokens", async () => {
    const reg = await registerUser();
    const { refresh_token: oldRefresh } = reg.json();

    const app = await getTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refresh_token: oldRefresh },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.access_token).toBeTruthy();
    // El nuevo refresh token debe ser diferente al anterior
    expect(body.refresh_token).not.toBe(oldRefresh);
  });

  it("rechaza el token una vez que ya fue rotado (previene replay)", async () => {
    const reg = await registerUser();
    const { refresh_token } = reg.json();

    const app = await getTestApp();
    // Primera rotación — ok
    await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refresh_token },
    });

    // Segunda rotación con el mismo token — debe fallar
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refresh_token },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("invalid_or_expired_token");
  });

  it("devuelve 401 con un token inventado", async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refresh_token: "token-que-no-existe-en-la-bd" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("devuelve 400 si no se envía refresh_token", async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─── Logout ──────────────────────────────────────────────────────────────────

describe("POST /v1/auth/logout", () => {
  it("revoca el refresh token y devuelve { ok: true }", async () => {
    const reg = await registerUser();
    const { access_token, refresh_token } = reg.json();

    const app = await getTestApp();
    const logoutRes = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: { Authorization: `Bearer ${access_token}` },
      payload: { refresh_token },
    });

    expect(logoutRes.statusCode).toBe(200);
    expect(logoutRes.json().ok).toBe(true);

    // El refresh token revocado ya no debe funcionar
    const refreshRes = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refresh_token },
    });
    expect(refreshRes.statusCode).toBe(401);
  });

  it("devuelve 401 sin access token", async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });
});
