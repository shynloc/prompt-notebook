ALTER TABLE "prompt_notes" ADD COLUMN "content_hash" text;--> statement-breakpoint
UPDATE "prompt_notes" SET "content_hash" = md5(lower(regexp_replace(trim("prompt"), '\s+', ' ', 'g')) || E'\n' || lower(regexp_replace(trim(coalesce("negative_prompt", '')), '\s+', ' ', 'g')));--> statement-breakpoint
CREATE INDEX "prompt_notes_user_active_updated_idx" ON "prompt_notes" USING btree ("user_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "prompt_notes"."deleted_at" is null and "prompt_notes"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "prompt_notes_user_content_hash_idx" ON "prompt_notes" USING btree ("user_id","content_hash") WHERE "prompt_notes"."deleted_at" is null and "prompt_notes"."content_hash" is not null;
