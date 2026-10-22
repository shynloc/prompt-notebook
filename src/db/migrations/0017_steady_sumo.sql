ALTER TABLE "ai_generation_assets" DROP CONSTRAINT "ai_generation_assets_role_check";--> statement-breakpoint
ALTER TABLE "ai_generation_jobs" DROP CONSTRAINT "ai_generation_jobs_quality_check";--> statement-breakpoint
ALTER TABLE "ai_generation_jobs" ADD COLUMN "result_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_generation_assets" ADD CONSTRAINT "ai_generation_assets_role_check" CHECK ("ai_generation_assets"."role" in ('reference', 'result', 'mask'));--> statement-breakpoint
ALTER TABLE "ai_generation_jobs" ADD CONSTRAINT "ai_generation_jobs_quality_check" CHECK ("ai_generation_jobs"."quality" in ('auto', 'low', 'medium', 'high', 'xhigh', 'max'));