import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const userProfiles = pgTable("user_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  nickname: text("nickname").notNull(),
  /** private | public — ver functional_decisions Instagram-like */
  accountVisibility: text("account_visibility").notNull().default("private"),
  locale: text("locale").notNull().default("es"),
  ianaTimezone: text("iana_timezone").notNull().default("Europe/Madrid"),
  /** sex: m | f | other | null */
  sex: text("sex"),
  /** birth_date ISO string YYYY-MM-DD */
  birthDate: text("birth_date"),
  avatarObjectKey: text("avatar_object_key"),
  bio: text("bio"),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Datos físicos + objetivo que el usuario introduce en el onboarding.
 * Una fila por sesión de onboarding; la activa es la última con
 * nutrition_target_set.is_active = true.
 */
export const userOnboardings = pgTable("user_onboardings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  weightKg: numeric("weight_kg", { precision: 5, scale: 2 }).notNull(),
  heightCm: integer("height_cm").notNull(),
  /**
   * Edad en el momento del onboarding (se guarda explícitamente para que
   * el cálculo no varíe si el usuario no actualiza su birthDate).
   */
  ageYears: integer("age_years").notNull(),
  /** m | f | other */
  sex: text("sex").notNull(),
  /**
   * sedentary | lightly_active | moderately_active | very_active | extra_active
   */
  activityLevel: text("activity_level").notNull(),
  /**
   * volumen_limpio | mantenimiento | definicion | recomposicion | perdida_peso
   */
  goalMode: text("goal_mode").notNull(),
  /** Objetivo de pasos NEAT diario sugerido por la app */
  neatFloorSuggestedSteps: integer("neat_floor_suggested_steps"),
  /** Objetivo de pasos NEAT que el usuario confirma */
  neatFloorSteps: integer("neat_floor_steps"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Objetivos calóricos y de macros calculados a partir de un onboarding.
 * Solo un registro por usuario puede tener is_active = true.
 */
export const nutritionTargetSets = pgTable("nutrition_target_sets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  sourceOnboardingId: uuid("source_onboarding_id")
    .notNull()
    .references(() => userOnboardings.id),
  /** Calorías diana diarias */
  kcalTarget: integer("kcal_target").notNull(),
  /** TDEE antes de aplicar el delta de objetivo */
  kcalTdee: integer("kcal_tdee").notNull(),
  /** Proteína mínima en gramos */
  proteinMinG: integer("protein_min_g").notNull(),
  /** Grasa mínima en gramos (≥20 % kcal) */
  fatMinG: integer("fat_min_g").notNull(),
  /** Grasa máxima en gramos (≤35 % kcal) */
  fatMaxG: integer("fat_max_g").notNull(),
  /** Carbohidratos objetivo en gramos (resto tras proteína y grasa diana) */
  carbsG: integer("carbs_g").notNull(),
  /**
   * Porcentaje de tolerancia sobre kcalTarget para marcar el día como verde.
   * 7 → ±7 % (volumen), 5 → ±5 % (mantenimiento/recomposición), etc.
   */
  kcalGreenPct: integer("kcal_green_pct").notNull().default(7),
  isActive: boolean("is_active").notNull().default(true),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Catálogo de alimentos compartido entre todos los usuarios.
 * Crece de forma incremental: cada usuario puede añadir nuevos alimentos.
 * Los marcados como is_verified han sido revisados por el equipo.
 */
export const foods = pgTable("foods", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  brand: text("brand"),
  kcalPer100g: numeric("kcal_per_100g", { precision: 7, scale: 2 }).notNull(),
  proteinPer100g: numeric("protein_per_100g", { precision: 6, scale: 2 }).notNull(),
  fatPer100g: numeric("fat_per_100g", { precision: 6, scale: 2 }).notNull(),
  carbsPer100g: numeric("carbs_per_100g", { precision: 6, scale: 2 }).notNull(),
  fiberPer100g: numeric("fiber_per_100g", { precision: 6, scale: 2 }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  isVerified: boolean("is_verified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Registro diario de comidas de un usuario.
 * Los valores calóricos y de macros se desnormalizan en el momento
 * del INSERT para que los totales del día sean rápidos de calcular.
 * food_id es nullable: las entradas del asesor IA usan food_name en su lugar.
 *
 * Estados (H2): draft → awaiting_media → ai_processing → pending_user_review → confirmed → corrected
 */
export const mealLogEntries = pgTable("meal_log_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Nullable: null cuando la entrada viene del asesor IA */
  foodId: uuid("food_id")
    .references(() => foods.id),
  /** Nombre del alimento cuando food_id es null (estimado por el asesor) */
  foodName: text("food_name"),
  /** Fecha en la zona horaria del usuario (YYYY-MM-DD) */
  nutritionDate: text("nutrition_date").notNull(),
  /** breakfast | lunch | dinner | snack | other */
  mealSlot: text("meal_slot").notNull(),
  quantityG: numeric("quantity_g", { precision: 7, scale: 1 }).notNull(),
  /** Valores calculados en el INSERT desde food × (quantityG / 100) */
  kcal: integer("kcal").notNull(),
  proteinG: numeric("protein_g", { precision: 6, scale: 1 }).notNull(),
  fatG: numeric("fat_g", { precision: 6, scale: 1 }).notNull(),
  carbsG: numeric("carbs_g", { precision: 6, scale: 1 }).notNull(),
  /** draft | awaiting_media | ai_processing | pending_user_review | confirmed | corrected */
  status: text("status").notNull().default("confirmed"),
  /** Nota opcional del usuario sobre la comida */
  userNote: text("user_note"),
  /** Timestamp real del registro (para ordenar dentro del slot) */
  loggedAt: timestamp("logged_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Historial de conversación con el asesor IA por usuario y día.
 * Ephemeral: se puede purgar pasados 7 días.
 */
export const advisorMessages = pgTable("advisor_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Fecha de la conversación (YYYY-MM-DD) */
  conversationDate: date("conversation_date").notNull(),
  /** user | assistant */
  role: text("role").notNull(),
  /** Contenido del mensaje; para el usuario puede ser la transcripción del audio */
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Alimentos frecuentes del usuario estimados por el asesor IA.
 * Se usan para re-añadir rápidamente en días posteriores.
 */
export const recurringFoods = pgTable("recurring_foods", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  /** Macros por la porción habitual */
  kcalPerServing: integer("kcal_per_serving").notNull(),
  proteinG: numeric("protein_g", { precision: 6, scale: 1 }).notNull(),
  fatG: numeric("fat_g", { precision: 6, scale: 1 }).notNull(),
  carbsG: numeric("carbs_g", { precision: 6, scale: 1 }).notNull(),
  quantityG: numeric("quantity_g", { precision: 7, scale: 1 }).notNull(),
  mealSlot: text("meal_slot").notNull().default("other"),
  timesUsed: integer("times_used").notNull().default(1),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Registro de peso corporal del usuario (un registro por día).
 * Se usa para seguimiento de evolución y comparación con el objetivo.
 */
export const weightLogs = pgTable("weight_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Fecha del pesaje en zona horaria del usuario (YYYY-MM-DD) */
  logDate: date("log_date").notNull(),
  /** Peso en kg con dos decimales */
  weightKg: numeric("weight_kg", { precision: 5, scale: 2 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Registro de actividad física por día.
 * Cada entrada añade kcal quemadas al target efectivo del día (EAT).
 */
export const workoutLogs = pgTable("workout_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Fecha del entrenamiento en zona horaria del usuario (YYYY-MM-DD) */
  workoutDate: date("workout_date").notNull(),
  /** Kcal estimadas quemadas durante el entrenamiento */
  kcalBurned: integer("kcal_burned").notNull(),
  /** Descripción opcional: "Pesas 1h", "Carrera 5km"... */
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Archivos multimedia asociados a una comida (fotos, audio).
 */
export const mealMedia = pgTable("meal_media", {
  id: uuid("id").primaryKey().defaultRandom(),
  mealEntryId: uuid("meal_entry_id")
    .notNull()
    .references(() => mealLogEntries.id, { onDelete: "cascade" }),
  /** image | audio */
  type: text("type").notNull(),
  /** Clave en object storage (MinIO/S3) */
  objectKey: text("object_key").notNull(),
  /** MIME type (image/jpeg, audio/webm, etc.) */
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  /** Duración en segundos (solo audio) */
  durationSec: numeric("duration_sec", { precision: 8, scale: 2 }),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Historial de correcciones aplicadas a una comida tras la estimación IA.
 */
export const mealCorrections = pgTable("meal_corrections", {
  id: uuid("id").primaryKey().defaultRandom(),
  mealEntryId: uuid("meal_entry_id")
    .notNull()
    .references(() => mealLogEntries.id, { onDelete: "cascade" }),
  /** Snapshot de los valores previos a la corrección */
  previousSnapshot: jsonb("previous_snapshot").notNull(),
  /** Explicación del usuario (texto) */
  userExplanationText: text("user_explanation_text"),
  /** Clave de audio con la corrección del usuario */
  audioObjectKey: text("audio_object_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Interacciones con IA (trazabilidad de cada request/response).
 */
export const aiInteractions = pgTable("ai_interactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  mealEntryId: uuid("meal_entry_id")
    .references(() => mealLogEntries.id, { onDelete: "set null" }),
  coachingMessageId: uuid("coaching_message_id"),
  /** request | response */
  direction: text("direction").notNull(),
  /** Modelo usado (gpt-4o, whisper-1, etc.) */
  modelId: text("model_id").notNull(),
  /** Request ID devuelto por OpenAI/OpenRouter */
  openrouterRequestId: text("openrouter_request_id"),
  /** Resumen de entrada: hashes/referencias a medios, transcript */
  inputSummary: jsonb("input_summary"),
  /** Texto crudo de salida */
  outputRaw: text("output_raw"),
  /** JSON validado de la salida nutricional */
  outputParsed: jsonb("output_parsed"),
  /** Latencia en ms */
  latencyMs: integer("latency_ms"),
  /** Uso de tokens (input, output, total) */
  tokenUsage: jsonb("token_usage"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Hilo de coaching conversacional con ventana deslizante de 7 días.
 */
export const coachingThreads = pgTable("coaching_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).defaultNow().notNull(),
  /** Resumen compacto para contexto en prompts LLM */
  summaryCompact: text("summary_compact"),
  /** Última actividad + 7 días → el job purga tras esta fecha */
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  /** active | purged */
  status: text("status").notNull().default("active"),
});

/**
 * Mensajes dentro de un hilo de coaching.
 */
export const coachingMessages = pgTable("coaching_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => coachingThreads.id, { onDelete: "cascade" }),
  /** user | assistant | system */
  role: text("role").notNull(),
  bodyText: text("body_text").notNull(),
  linkedMealEntryId: uuid("linked_meal_entry_id")
    .references(() => mealLogEntries.id, { onDelete: "set null" }),
  attachmentObjectKey: text("attachment_object_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Catálogo interno incremental de alimentos observados.
 * Se actualiza tras cada comida confirmada (upsert estadístico).
 */
export const foodItemObservations = pgTable("food_item_observations", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Nombre normalizado del alimento */
  normalizedName: text("normalized_name").notNull().unique(),
  /** Macros por 100g o por porción */
  per100gOrServing: jsonb("per_100g_or_serving"),
  /** Cuántas veces se ha visto este alimento */
  seenCount: integer("seen_count").notNull().default(1),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  sourceUserId: uuid("source_user_id")
    .references(() => users.id, { onDelete: "set null" }),
});

// ─── relations (needed for Drizzle query API `with:`) ────────────────────────

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(userProfiles, {
    fields: [users.id],
    references: [userProfiles.userId],
  }),
  refreshTokens: many(refreshTokens),
  onboardings: many(userOnboardings),
  nutritionTargets: many(nutritionTargetSets),
  mealLogEntries: many(mealLogEntries),
  foods: many(foods),
  workoutLogs: many(workoutLogs),
  weightLogs: many(weightLogs),
  advisorMessages: many(advisorMessages),
  recurringFoods: many(recurringFoods),
}));

export const weightLogsRelations = relations(weightLogs, ({ one }) => ({
  user: one(users, { fields: [weightLogs.userId], references: [users.id] }),
}));

export const workoutLogsRelations = relations(workoutLogs, ({ one }) => ({
  user: one(users, { fields: [workoutLogs.userId], references: [users.id] }),
}));

export const advisorMessagesRelations = relations(advisorMessages, ({ one }) => ({
  user: one(users, { fields: [advisorMessages.userId], references: [users.id] }),
}));

export const recurringFoodsRelations = relations(recurringFoods, ({ one }) => ({
  user: one(users, { fields: [recurringFoods.userId], references: [users.id] }),
}));

export const foodsRelations = relations(foods, ({ one, many }) => ({
  createdByUser: one(users, { fields: [foods.createdBy], references: [users.id] }),
  mealLogEntries: many(mealLogEntries),
}));

export const mealLogEntriesRelations = relations(mealLogEntries, ({ one, many }) => ({
  user: one(users, { fields: [mealLogEntries.userId], references: [users.id] }),
  food: one(foods, { fields: [mealLogEntries.foodId], references: [foods.id] }),
  media: many(mealMedia),
  corrections: many(mealCorrections),
}));

export const mealMediaRelations = relations(mealMedia, ({ one }) => ({
  mealEntry: one(mealLogEntries, { fields: [mealMedia.mealEntryId], references: [mealLogEntries.id] }),
}));

export const mealCorrectionsRelations = relations(mealCorrections, ({ one }) => ({
  mealEntry: one(mealLogEntries, { fields: [mealCorrections.mealEntryId], references: [mealLogEntries.id] }),
}));

export const aiInteractionsRelations = relations(aiInteractions, ({ one }) => ({
  mealEntry: one(mealLogEntries, { fields: [aiInteractions.mealEntryId], references: [mealLogEntries.id] }),
}));

export const coachingThreadsRelations = relations(coachingThreads, ({ one, many }) => ({
  user: one(users, { fields: [coachingThreads.userId], references: [users.id] }),
  messages: many(coachingMessages),
}));

export const coachingMessagesRelations = relations(coachingMessages, ({ one }) => ({
  thread: one(coachingThreads, { fields: [coachingMessages.threadId], references: [coachingThreads.id] }),
  mealEntry: one(mealLogEntries, { fields: [coachingMessages.linkedMealEntryId], references: [mealLogEntries.id] }),
}));

export const foodItemObservationsRelations = relations(foodItemObservations, ({ one }) => ({
  sourceUser: one(users, { fields: [foodItemObservations.sourceUserId], references: [users.id] }),
}));

export const userOnboardingsRelations = relations(userOnboardings, ({ one }) => ({
  user: one(users, { fields: [userOnboardings.userId], references: [users.id] }),
  nutritionTarget: one(nutritionTargetSets, {
    fields: [userOnboardings.id],
    references: [nutritionTargetSets.sourceOnboardingId],
  }),
}));

export const nutritionTargetSetsRelations = relations(nutritionTargetSets, ({ one }) => ({
  user: one(users, { fields: [nutritionTargetSets.userId], references: [users.id] }),
  sourceOnboarding: one(userOnboardings, {
    fields: [nutritionTargetSets.sourceOnboardingId],
    references: [userOnboardings.id],
  }),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, {
    fields: [userProfiles.userId],
    references: [users.id],
  }),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokens.userId],
    references: [users.id],
  }),
}));
