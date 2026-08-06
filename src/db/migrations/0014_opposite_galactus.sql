ALTER TABLE "generation_character_references" DROP CONSTRAINT "generation_character_references_asset_fk";
--> statement-breakpoint
ALTER TABLE "ai_generation_assets" ADD CONSTRAINT "ai_generation_assets_id_job_user_unique" UNIQUE("id","job_id","user_id");--> statement-breakpoint
ALTER TABLE "generation_character_references" ADD CONSTRAINT "generation_character_references_asset_job_owner_fk" FOREIGN KEY ("generation_asset_id","job_id","user_id") REFERENCES "public"."ai_generation_assets"("id","job_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "note_character_profiles_note_order_unique" ON "note_character_profiles" USING btree ("note_id","sort_order");
