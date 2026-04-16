-- Add status and plannedAt fields to workout_logs for planned workouts feature
ALTER TABLE "workout_logs" ADD COLUMN "status" text NOT NULL DEFAULT 'done';
ALTER TABLE "workout_logs" ADD COLUMN "planned_at" text;
ALTER TABLE "workout_logs" ALTER COLUMN "kcal_burned" SET DEFAULT 0;
