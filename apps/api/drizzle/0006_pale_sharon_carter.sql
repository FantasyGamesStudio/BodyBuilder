CREATE TABLE "ai_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_entry_id" uuid,
	"coaching_message_id" uuid,
	"direction" text NOT NULL,
	"model_id" text NOT NULL,
	"openrouter_request_id" text,
	"input_summary" jsonb,
	"output_raw" text,
	"output_parsed" jsonb,
	"latency_ms" integer,
	"token_usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coaching_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"role" text NOT NULL,
	"body_text" text NOT NULL,
	"linked_meal_entry_id" uuid,
	"attachment_object_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coaching_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary_compact" text,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_item_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"normalized_name" text NOT NULL,
	"per_100g_or_serving" jsonb,
	"seen_count" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_user_id" uuid,
	CONSTRAINT "food_item_observations_normalized_name_unique" UNIQUE("normalized_name")
);
--> statement-breakpoint
CREATE TABLE "meal_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_entry_id" uuid NOT NULL,
	"previous_snapshot" jsonb NOT NULL,
	"user_explanation_text" text,
	"audio_object_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_entry_id" uuid NOT NULL,
	"type" text NOT NULL,
	"object_key" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"duration_sec" numeric(8, 2),
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weight_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"log_date" date NOT NULL,
	"weight_kg" numeric(5, 2) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meal_log_entries" ADD COLUMN "status" text DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_log_entries" ADD COLUMN "user_note" text;--> statement-breakpoint
ALTER TABLE "ai_interactions" ADD CONSTRAINT "ai_interactions_meal_entry_id_meal_log_entries_id_fk" FOREIGN KEY ("meal_entry_id") REFERENCES "public"."meal_log_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_messages" ADD CONSTRAINT "coaching_messages_thread_id_coaching_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."coaching_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_messages" ADD CONSTRAINT "coaching_messages_linked_meal_entry_id_meal_log_entries_id_fk" FOREIGN KEY ("linked_meal_entry_id") REFERENCES "public"."meal_log_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_threads" ADD CONSTRAINT "coaching_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_item_observations" ADD CONSTRAINT "food_item_observations_source_user_id_users_id_fk" FOREIGN KEY ("source_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_corrections" ADD CONSTRAINT "meal_corrections_meal_entry_id_meal_log_entries_id_fk" FOREIGN KEY ("meal_entry_id") REFERENCES "public"."meal_log_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_media" ADD CONSTRAINT "meal_media_meal_entry_id_meal_log_entries_id_fk" FOREIGN KEY ("meal_entry_id") REFERENCES "public"."meal_log_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_logs" ADD CONSTRAINT "weight_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;