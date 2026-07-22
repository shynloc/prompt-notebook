DROP INDEX "prompt_images_provider_key_unique";--> statement-breakpoint
CREATE INDEX "prompt_images_provider_key_idx" ON "prompt_images" USING btree ("storage_provider","object_key");