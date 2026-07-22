CREATE TABLE "media_storage_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"provider_type" text DEFAULT 'picbed' NOT NULL,
	"endpoint" text NOT NULL,
	"encrypted_secret" text NOT NULL,
	"secret_iv" text NOT NULL,
	"secret_auth_tag" text NOT NULL,
	"secret_key_id" text NOT NULL,
	"secret_hint" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_test_status" text,
	"last_test_message" text,
	"last_tested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_storage_settings_provider_check" CHECK ("media_storage_settings"."provider_type" in ('picbed')),
	CONSTRAINT "media_storage_settings_test_status_check" CHECK ("media_storage_settings"."last_test_status" is null or "media_storage_settings"."last_test_status" in ('success', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "media_storage_settings" ADD CONSTRAINT "media_storage_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;