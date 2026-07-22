ALTER TABLE "note_shares" ADD COLUMN "encrypted_token" text;--> statement-breakpoint
ALTER TABLE "note_shares" ADD COLUMN "token_iv" text;--> statement-breakpoint
ALTER TABLE "note_shares" ADD COLUMN "token_auth_tag" text;--> statement-breakpoint
ALTER TABLE "note_shares" ADD COLUMN "token_key_id" text;