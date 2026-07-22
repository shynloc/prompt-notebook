CREATE TABLE "extension_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extension_authorization_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"device_name" text NOT NULL,
	"code_challenge" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extension_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "extension_refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prompt_notes" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "prompt_notes" ADD COLUMN "source_title" text;--> statement-breakpoint
ALTER TABLE "prompt_notes" ADD COLUMN "captured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prompt_notes" ADD COLUMN "capture_method" text;--> statement-breakpoint
ALTER TABLE "extension_access_tokens" ADD CONSTRAINT "extension_access_tokens_device_id_extension_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."extension_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_authorization_codes" ADD CONSTRAINT "extension_authorization_codes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_devices" ADD CONSTRAINT "extension_devices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_refresh_tokens" ADD CONSTRAINT "extension_refresh_tokens_device_id_extension_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."extension_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "extension_access_tokens_hash_unique" ON "extension_access_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "extension_access_tokens_expiry_idx" ON "extension_access_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "extension_authorization_codes_hash_unique" ON "extension_authorization_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "extension_authorization_codes_expiry_idx" ON "extension_authorization_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "extension_devices_user_idx" ON "extension_devices" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "extension_refresh_tokens_hash_unique" ON "extension_refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "extension_refresh_tokens_expiry_idx" ON "extension_refresh_tokens" USING btree ("expires_at");