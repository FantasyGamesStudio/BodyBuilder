CREATE TABLE "weight_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "log_date" date NOT NULL,
  "weight_kg" numeric(5, 2) NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "weight_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade
);

-- Un peso por usuario por día (upsert vía ON CONFLICT)
CREATE UNIQUE INDEX "weight_logs_user_date_idx" ON "weight_logs" ("user_id", "log_date");
