CREATE TABLE "character_profile_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"storage_provider" text NOT NULL,
	"object_key" text NOT NULL,
	"display_url" text NOT NULL,
	"thumbnail_url" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size_bytes" bigint NOT NULL,
	"view_type" text DEFAULT 'other' NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_cover" boolean DEFAULT false NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"focus_x" integer DEFAULT 50 NOT NULL,
	"focus_y" integer DEFAULT 50 NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_profile_images_id_user_unique" UNIQUE("id","user_id"),
	CONSTRAINT "character_profile_images_provider_check" CHECK ("character_profile_images"."storage_provider" in ('picbed', 'external')),
	CONSTRAINT "character_profile_images_mime_check" CHECK ("character_profile_images"."mime_type" in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
	CONSTRAINT "character_profile_images_view_check" CHECK ("character_profile_images"."view_type" in ('portrait', 'half_body', 'full_body', 'left', 'right', 'back', 'expression', 'outfit', 'other')),
	CONSTRAINT "character_profile_images_status_check" CHECK ("character_profile_images"."status" in ('ready', 'failed')),
	CONSTRAINT "character_profile_images_dimensions_check" CHECK ("character_profile_images"."width" > 0 and "character_profile_images"."height" > 0 and "character_profile_images"."size_bytes" >= 0),
	CONSTRAINT "character_profile_images_focus_check" CHECK ("character_profile_images"."focus_x" between 0 and 100 and "character_profile_images"."focus_y" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "character_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"role_definition" text NOT NULL,
	"use_cases" text[] DEFAULT '{}' NOT NULL,
	"appearance" text DEFAULT '' NOT NULL,
	"prompt_anchor" text DEFAULT '' NOT NULL,
	"negative_prompt" text DEFAULT '' NOT NULL,
	"rights_note" text DEFAULT '' NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_profiles_id_user_unique" UNIQUE("id","user_id"),
	CONSTRAINT "character_profiles_version_check" CHECK ("character_profiles"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "generation_character_references" (
	"job_id" uuid NOT NULL,
	"generation_asset_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"profile_image_id" uuid NOT NULL,
	"profile_name_snapshot" text NOT NULL,
	"profile_version_snapshot" integer NOT NULL,
	"view_type_snapshot" text NOT NULL,
	"role" text DEFAULT 'primary' NOT NULL,
	"ordinal" integer NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_character_references_job_id_ordinal_pk" PRIMARY KEY("job_id","ordinal"),
	CONSTRAINT "generation_character_references_ordinal_check" CHECK ("generation_character_references"."ordinal" >= 0 and "generation_character_references"."ordinal" < 4),
	CONSTRAINT "generation_character_references_role_check" CHECK ("generation_character_references"."role" in ('primary', 'supporting', 'reference'))
);
--> statement-breakpoint
CREATE TABLE "note_character_profiles" (
	"note_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'primary' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_character_profiles_note_id_profile_id_pk" PRIMARY KEY("note_id","profile_id"),
	CONSTRAINT "note_character_profiles_role_check" CHECK ("note_character_profiles"."role" in ('primary', 'supporting', 'reference')),
	CONSTRAINT "note_character_profiles_order_check" CHECK ("note_character_profiles"."sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "character_profile_images" ADD CONSTRAINT "character_profile_images_profile_owner_fk" FOREIGN KEY ("profile_id","user_id") REFERENCES "public"."character_profiles"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_profiles" ADD CONSTRAINT "character_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_character_references" ADD CONSTRAINT "generation_character_references_job_owner_fk" FOREIGN KEY ("job_id","user_id") REFERENCES "public"."ai_generation_jobs"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_character_references" ADD CONSTRAINT "generation_character_references_asset_fk" FOREIGN KEY ("generation_asset_id") REFERENCES "public"."ai_generation_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_character_profiles" ADD CONSTRAINT "note_character_profiles_note_owner_fk" FOREIGN KEY ("note_id","user_id") REFERENCES "public"."prompt_notes"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_character_profiles" ADD CONSTRAINT "note_character_profiles_profile_owner_fk" FOREIGN KEY ("profile_id","user_id") REFERENCES "public"."character_profiles"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "character_profile_images_profile_order_unique" ON "character_profile_images" USING btree ("profile_id","sort_order") WHERE "character_profile_images"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "character_profile_images_one_cover_unique" ON "character_profile_images" USING btree ("profile_id") WHERE "character_profile_images"."is_cover" = true and "character_profile_images"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "character_profile_images_one_primary_unique" ON "character_profile_images" USING btree ("profile_id") WHERE "character_profile_images"."is_primary" = true and "character_profile_images"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "character_profile_images_user_profile_idx" ON "character_profile_images" USING btree ("user_id","profile_id");--> statement-breakpoint
CREATE INDEX "character_profiles_user_name_idx" ON "character_profiles" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "character_profiles_user_status_updated_idx" ON "character_profiles" USING btree ("user_id","deleted_at","archived_at","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "generation_character_references_asset_unique" ON "generation_character_references" USING btree ("generation_asset_id");--> statement-breakpoint
CREATE INDEX "generation_character_references_user_profile_idx" ON "generation_character_references" USING btree ("user_id","profile_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "note_character_profiles_one_primary_unique" ON "note_character_profiles" USING btree ("note_id") WHERE "note_character_profiles"."role" = 'primary';--> statement-breakpoint
CREATE INDEX "note_character_profiles_user_profile_idx" ON "note_character_profiles" USING btree ("user_id","profile_id","note_id");