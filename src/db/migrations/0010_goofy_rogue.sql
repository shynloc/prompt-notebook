ALTER TABLE "ai_generation_jobs" DROP CONSTRAINT "ai_generation_jobs_dimensions_check";--> statement-breakpoint
ALTER TABLE "ai_generation_jobs" DROP CONSTRAINT "ai_generation_jobs_quality_check";--> statement-breakpoint
UPDATE "ai_generation_jobs" SET "quality" = 'medium' WHERE "quality" = 'standard';--> statement-breakpoint
ALTER TABLE "ai_generation_jobs" ADD CONSTRAINT "ai_generation_jobs_dimensions_check" CHECK ("ai_generation_jobs"."width" between 256 and 3840 and "ai_generation_jobs"."height" between 256 and 3840);--> statement-breakpoint
ALTER TABLE "ai_generation_jobs" ADD CONSTRAINT "ai_generation_jobs_quality_check" CHECK ("ai_generation_jobs"."quality" in ('auto', 'low', 'medium', 'high'));
