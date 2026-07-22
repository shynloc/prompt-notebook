CREATE TABLE "note_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"allow_copy" boolean DEFAULT true NOT NULL,
	"include_image" boolean DEFAULT true NOT NULL,
	"include_source" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "note_shares" ADD CONSTRAINT "note_shares_note_owner_fk" FOREIGN KEY ("note_id","user_id") REFERENCES "public"."prompt_notes"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "note_shares_token_hash_unique" ON "note_shares" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "note_shares_user_note_created_idx" ON "note_shares" USING btree ("user_id","note_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "note_shares_expiry_idx" ON "note_shares" USING btree ("expires_at");