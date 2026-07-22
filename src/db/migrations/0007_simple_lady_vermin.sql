CREATE TABLE "ai_model_preferences" (
	"user_id" text NOT NULL,
	"purpose" text NOT NULL,
	"model_profile_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_model_preferences_user_id_purpose_pk" PRIMARY KEY("user_id","purpose"),
	CONSTRAINT "ai_model_preferences_purpose_check" CHECK ("ai_model_preferences"."purpose" in ('prompt_optimization', 'image_generation', 'reverse_prompt'))
);
--> statement-breakpoint
CREATE TABLE "ai_model_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"model_id" text NOT NULL,
	"display_name" text NOT NULL,
	"capabilities" text[] NOT NULL,
	"default_parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_model_profiles_id_user_unique" UNIQUE("id","user_id")
);
--> statement-breakpoint
CREATE TABLE "ai_provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"provider_type" text DEFAULT 'openai_compatible' NOT NULL,
	"base_url" text NOT NULL,
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
	CONSTRAINT "ai_provider_connections_id_user_unique" UNIQUE("id","user_id"),
	CONSTRAINT "ai_provider_connections_type_check" CHECK ("ai_provider_connections"."provider_type" in ('openai_compatible')),
	CONSTRAINT "ai_provider_connections_test_status_check" CHECK ("ai_provider_connections"."last_test_status" is null or "ai_provider_connections"."last_test_status" in ('success', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "ai_model_preferences" ADD CONSTRAINT "ai_model_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_preferences" ADD CONSTRAINT "ai_model_preferences_profile_owner_fk" FOREIGN KEY ("model_profile_id","user_id") REFERENCES "public"."ai_model_profiles"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_profiles" ADD CONSTRAINT "ai_model_profiles_connection_owner_fk" FOREIGN KEY ("connection_id","user_id") REFERENCES "public"."ai_provider_connections"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_connections" ADD CONSTRAINT "ai_provider_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_model_preferences_profile_idx" ON "ai_model_preferences" USING btree ("model_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_model_profiles_connection_model_unique" ON "ai_model_profiles" USING btree ("connection_id","model_id");--> statement-breakpoint
CREATE INDEX "ai_model_profiles_user_enabled_updated_idx" ON "ai_model_profiles" USING btree ("user_id","enabled","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "ai_provider_connections_user_name_unique" ON "ai_provider_connections" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "ai_provider_connections_user_enabled_updated_idx" ON "ai_provider_connections" USING btree ("user_id","enabled","updated_at" DESC NULLS LAST);