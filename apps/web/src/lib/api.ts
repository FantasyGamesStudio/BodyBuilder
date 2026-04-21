/**
 * Cliente HTTP tipado para la API de BodyBuilder.
 *
 * - Añade el Authorization header automáticamente desde localStorage
 * - Reintenta con refresh token si recibe 401
 * - Lanza ApiError con código y mensaje legible
 */

// En producción, VITE_API_URL apunta al dominio de la API (Railway).
// En desarrollo, queda vacío y el proxy de Vite redirige /v1 → localhost:3000.
const BASE = `${import.meta.env.VITE_API_URL ?? ""}/v1`;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ─── Token store ─────────────────────────────────────────────────────────────

export const tokens = {
  get access(): string | null {
    return localStorage.getItem("bb_access_token");
  },
  get refresh(): string | null {
    return localStorage.getItem("bb_refresh_token");
  },
  set(access: string, refresh: string) {
    localStorage.setItem("bb_access_token", access);
    localStorage.setItem("bb_refresh_token", refresh);
  },
  clear() {
    localStorage.removeItem("bb_access_token");
    localStorage.removeItem("bb_refresh_token");
  },
};

// ─── Core fetch ──────────────────────────────────────────────────────────────

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const rt = tokens.refresh;
  if (!rt) return false;
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: rt }),
    });
    if (!res.ok) { tokens.clear(); return false; }
    const data = await res.json() as TokenResponse;
    tokens.set(data.access_token, data.refresh_token);
    return true;
  } catch {
    tokens.clear();
    return false;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  retry = true,
): Promise<T> {
  const headers: Record<string, string> = { "Cache-Control": "no-cache" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (tokens.access) headers["Authorization"] = `Bearer ${tokens.access}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry) {
    if (!refreshing) refreshing = tryRefresh().finally(() => { refreshing = null; });
    const ok = await refreshing;
    if (ok) return request<T>(method, path, body, false);
    tokens.clear();
    window.location.href = "/auth/login";
    throw new ApiError(401, "unauthorized", "Sesión expirada");
  }

  if (!res.ok) {
    let code = "unknown_error";
    let message = `HTTP ${res.status}`;
    try {
      const json = await res.json() as { error?: string; message?: string };
      code = json.error ?? code;
      message = json.message ?? json.error ?? message;
    } catch { /* empty */ }
    throw new ApiError(res.status, code, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

// ─── Tipos de respuesta ───────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: string;
  refresh_token: string;
}

export interface UserProfile {
  id: string;
  userId: string;
  nickname: string;
  accountVisibility: "private" | "public";
  locale: string;
  ianaTimezone: string;
  sex: "m" | "f" | "other" | null;
  birthDate: string | null;
  bio: string | null;
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MeResponse {
  id: string;
  email: string;
  createdAt: string;
  profile: UserProfile;
}

export interface ActiveTarget {
  id: string;
  kcalTarget: number;
  kcalTdee: number;
  proteinMinG: number;
  fatMinG: number;
  fatMaxG: number;
  carbsG: number;
  kcalGreenPct: number;
  kcalRangeMin: number;
  kcalRangeMax: number;
  effectiveFrom: string;
  goalMode: string;
  activityLevel: string;
  weightKg: number;
  heightCm: number | null;
  ageYears: number | null;
  sex: string | null;
  neatFloorSteps: number | null;
}

export interface OnboardingSuggestion {
  bmr: number;
  tdee: number;
  kcalTarget: number;
  proteinMinG: number;
  fatMinG: number;
  fatMaxG: number;
  carbsG: number;
  kcalGreenPct: number;
  neatSuggestedSteps: number;
  kcalRangeMin: number;
  kcalRangeMax: number;
}

export interface Food {
  id: string;
  name: string;
  brand: string | null;
  kcalPer100g: number;
  proteinPer100g: number;
  fatPer100g: number;
  carbsPer100g: number;
  fiberPer100g: number | null;
  isVerified: boolean;
  createdAt: string;
}

export interface MealEntry {
  id: string;
  foodId: string;
  food: { id: string; name: string; brand: string | null } | null;
  nutritionDate: string;
  mealSlot: string;
  quantityG: number;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  loggedAt: string;
}

export interface DayProgress {
  totals: { kcal: number; proteinG: number; fatG: number; carbsG: number };
  kcalPct: number;
  proteinPct: number;
  fatPct: number;
  carbsPct: number;
  kcalStatus: "green" | "yellow" | "red";
}

export interface WorkoutLog {
  id: string;
  workoutDate: string;
  kcalBurned: number;
  notes: string | null;
  status: "done" | "planned";
  plannedAt: string | null;
  createdAt: string;
}

export interface DayResponse {
  date: string;
  entries: MealEntry[];
  bySlot: Record<string, MealEntry[]>;
  workouts: WorkoutLog[];
  eatKcal: number;
  goalMode: string | null;
  progress: DayProgress | null;
}

// ─── Helpers de API ───────────────────────────────────────────────────────────

export const authApi = {
  register: (email: string, password: string, nickname: string) =>
    api.post<TokenResponse>("/auth/register", { email, password, nickname }),
  login: (email: string, password: string) =>
    api.post<TokenResponse>("/auth/login", { email, password }),
  logout: (refresh_token: string) =>
    api.post<{ ok: boolean }>("/auth/logout", { refresh_token }),
};

export const meApi = {
  get: () => api.get<MeResponse>("/me"),
  patch: (data: Partial<UserProfile>) => api.patch<MeResponse>("/me", data),
};

export const onboardingApi = {
  suggestion: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    ).toString();
    return api.get<OnboardingSuggestion>(`/onboarding/suggestion?${qs}`);
  },
  complete: (data: Record<string, unknown>) =>
    api.post<{ onboardingId: string; targetSetId: string; suggestion: OnboardingSuggestion }>(
      "/onboarding",
      data,
    ),
  activeTarget: () => api.get<ActiveTarget>("/onboarding/active-target"),
};

export const foodsApi = {
  search: (q: string, limit = 20) =>
    api.get<{ items: Food[]; total: number }>(`/foods/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  create: (data: Omit<Food, "id" | "isVerified" | "createdAt">) =>
    api.post<Food>("/foods", data),
};

export interface WeekDaySummary {
  date: string;
  hasData: boolean;
  eatKcal: number;
  kcalTarget: number;
  progress: DayProgress | null;
}

export interface WeekResponse {
  weekStart: string;
  weekEnd: string;
  days: WeekDaySummary[];
  weekTotals: { kcal: number; proteinG: number; fatG: number; carbsG: number };
  target: {
    kcalTarget: number;
    proteinMinG: number;
    fatMinG: number;
    fatMaxG: number;
    carbsG: number;
  } | null;
}

export interface MonthDaySummary {
  date: string;
  hasData: boolean;
  kcalConsumed: number;
  kcalTarget: number;
  status: "green" | "yellow" | "red" | null;
}

export interface MonthResponse {
  yearMonth: string;
  days: MonthDaySummary[];
}

export const mealsApi = {
  day: (date: string) => api.get<DayResponse>(`/meals/day/${date}`),
  week: (weekStart: string) => api.get<WeekResponse>(`/meals/week/${weekStart}`),
  month: (yearMonth: string) => api.get<MonthResponse>(`/meals/month/${yearMonth}`),
  log: (data: { foodId: string; nutritionDate: string; mealSlot: string; quantityG: number }) =>
    api.post<MealEntry>("/meals", data),
  update: (id: string, data: { quantityG?: number; mealSlot?: string }) =>
    api.patch<MealEntry>(`/meals/${id}`, data),
  delete: (id: string) => api.delete<{ ok: boolean }>(`/meals/${id}`),
};

export const workoutsApi = {
  log: (data: { workoutDate: string; kcalBurned: number; notes?: string; status?: "done" | "planned"; plannedAt?: string }) =>
    api.post<WorkoutLog>("/workouts", data),
  patch: (id: string, data: { kcalBurned?: number; notes?: string; status?: "done" | "planned"; plannedAt?: string | null }) =>
    api.patch<WorkoutLog>(`/workouts/${id}`, data),
  delete: (id: string) => api.delete<null>(`/workouts/${id}`),
};

// ─── Advisor ─────────────────────────────────────────────────────────────────

export interface AdvisorMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface AdvisorAddedEntry {
  id: string;
  name: string;
  mealSlot: string;
  quantityG: number;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

export interface AdvisorResponse {
  reply: string;
  addedEntries: AdvisorAddedEntry[];
  transcription?: string;
}

export interface RecurringFood {
  id: string;
  name: string;
  description: string | null;
  kcalPerServing: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  quantityG: number;
  mealSlot: string;
  timesUsed: number;
}

export const advisorApi = {
  history: (date: string) =>
    api.get<{ messages: AdvisorMessage[] }>(`/advisor/${date}/history`),
  message: (date: string, data: {
    text?: string;
    audioBase64?: string;
    imageBase64?: string;
    imageMimeType?: string;
    images?: Array<{ imageBase64: string; mimeType: string }>;
  }) => api.post<AdvisorResponse>(`/advisor/${date}/message`, data),
  recurring: () => api.get<{ items: RecurringFood[] }>("/advisor/recurring"),
  markRecurring: (mealEntryId: string) =>
    api.post<{ id: string }>("/advisor/recurring", { mealEntryId }),
  logRecurring: (id: string, nutritionDate: string, mealSlot?: string, quantityG?: number) =>
    api.post<{ id: string }>(`/advisor/recurring/${id}/log`, {
      nutritionDate,
      mealSlot,
      ...(quantityG !== undefined ? { quantityG } : {}),
    }),
  deleteRecurring: (id: string) =>
    api.delete<{ ok: boolean }>(`/advisor/recurring/${id}`),
  transcribe: async (audioBase64: string, mimeType?: string): Promise<{ text: string }> => {
    // Llama a la Vercel Serverless Function directamente (no pasa por Railway)
    const res = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64, mimeType }),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: string };
      throw new ApiError(res.status, "transcribe_error", err.error ?? "Error al transcribir");
    }
    return res.json() as Promise<{ text: string }>;
  },
};
