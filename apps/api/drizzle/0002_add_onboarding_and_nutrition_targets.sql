CREATE TABLE "nutrition_target_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_onboarding_id" uuid NOT NULL,
	"kcal_target" integer NOT NULL,
	"kcal_tdee" integer NOT NULL,
	"protein_min_g" integer NOT NULL,
	"fat_min_g" integer NOT NULL,
	"fat_max_g" integer NOT NULL,
	"carbs_g" integer NOT NULL,
	"kcal_green_pct" integer DEFAULT 7 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_onboardings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"weight_kg" numeric(5, 2) NOT NULL,
	"height_cm" integer NOT NULL,
	"age_years" integer NOT NULL,
	"sex" text NOT NULL,
	"activity_level" text NOT NULL,
	"goal_mode" text NOT NULL,
	"neat_floor_suggested_steps" integer,
	"neat_floor_steps" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nutrition_target_sets" ADD CONSTRAINT "nutrition_target_sets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_target_sets" ADD CONSTRAINT "nutrition_target_sets_source_onboarding_id_user_onboardings_id_fk" FOREIGN KEY ("source_onboarding_id") REFERENCES "public"."user_onboardings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_onboardings" ADD CONSTRAINT "user_onboardings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;