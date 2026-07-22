CREATE TABLE "ai_generation_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"storage_provider" text NOT NULL,
	"object_key" text NOT NULL,
	"display_url" text NOT NULL,
	"thumbnail_url" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size_bytes" bigint NOT NULL,
	"ordinal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_generation_assets_role_check" CHECK ("ai_generation_assets"."role" in ('reference', 'result')),
	CONSTRAINT "ai_generation_assets_ordinal_check" CHECK ("ai_generation_assets"."ordinal" >= 0),
	CONSTRAINT "ai_generation_assets_dimensions_check" CHECK ("ai_generation_assets"."width" > 0 and "ai_generation_assets"."height" > 0 and "ai_generation_assets"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "ai_generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"model_profile_id" uuid,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"kind" text DEFAULT 'text_to_image' NOT NULL,
	"status" text DEFAULT 'preparing' NOT NULL,
	"prompt" text NOT NULL,
	"negative_prompt" text,
	"model_id" text NOT NULL,
	"model_name" text NOT NULL,
	"provider_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"quality" text NOT NULL,
	"image_count" integer NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_generation_jobs_id_user_unique" UNIQUE("id","user_id"),
	CONSTRAINT "ai_generation_jobs_kind_check" CHECK ("ai_generation_jobs"."kind" in ('text_to_image', 'image_to_image')),
	CONSTRAINT "ai_generation_jobs_status_check" CHECK ("ai_generation_jobs"."status" in ('preparing', 'queued', 'running', 'cancel_requested', 'cancelled', 'succeeded', 'failed')),
	CONSTRAINT "ai_generation_jobs_dimensions_check" CHECK ("ai_generation_jobs"."width" between 256 and 2048 and "ai_generation_jobs"."height" between 256 and 2048),
	CONSTRAINT "ai_generation_jobs_quality_check" CHECK ("ai_generation_jobs"."quality" in ('standard', 'high')),
	CONSTRAINT "ai_generation_jobs_count_check" CHECK ("ai_generation_jobs"."image_count" between 1 and 4),
	CONSTRAINT "ai_generation_jobs_attempts_check" CHECK ("ai_generation_jobs"."attempts" >= 0 and "ai_generation_jobs"."max_attempts" between 1 and 5),
	CONSTRAINT "ai_generation_jobs_progress_check" CHECK ("ai_generation_jobs"."progress" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "ai_generation_assets" ADD CONSTRAINT "ai_generation_assets_job_owner_fk" FOREIGN KEY ("job_id","user_id") REFERENCES "public"."ai_generation_jobs"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generation_jobs" ADD CONSTRAINT "ai_generation_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generation_jobs" ADD CONSTRAINT "ai_generation_jobs_model_owner_fk" FOREIGN KEY ("model_profile_id","user_id") REFERENCES "public"."ai_model_profiles"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_generation_assets_job_role_ordinal_unique" ON "ai_generation_assets" USING btree ("job_id","role","ordinal");--> statement-breakpoint
CREATE INDEX "ai_generation_assets_user_job_idx" ON "ai_generation_assets" USING btree ("user_id","job_id");--> statement-breakpoint
CREATE INDEX "ai_generation_assets_provider_key_idx" ON "ai_generation_assets" USING btree ("storage_provider","object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_generation_jobs_user_idempotency_unique" ON "ai_generation_jobs" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ai_generation_jobs_model_profile_idx" ON "ai_generation_jobs" USING btree ("model_profile_id");--> statement-breakpoint
CREATE INDEX "ai_generation_jobs_user_created_idx" ON "ai_generation_jobs" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_generation_jobs_user_active_created_idx" ON "ai_generation_jobs" USING btree ("user_id","created_at" DESC NULLS LAST) WHERE "ai_generation_jobs"."status" in ('preparing', 'queued', 'running', 'cancel_requested');--> statement-breakpoint
CREATE INDEX "ai_generation_jobs_stale_running_idx" ON "ai_generation_jobs" USING btree ("heartbeat_at") WHERE "ai_generation_jobs"."status" = 'running';