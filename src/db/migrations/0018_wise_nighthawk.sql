CREATE TABLE "local_media_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"object_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "local_media_objects_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "local_media_objects_mime_check" CHECK ("local_media_objects"."mime_type" in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "local_media_objects_size_check" CHECK ("local_media_objects"."size_bytes" > 0 and "local_media_objects"."size_bytes" <= 33554432),
	CONSTRAINT "local_media_objects_dimensions_check" CHECK ("local_media_objects"."width" > 0 and "local_media_objects"."height" > 0)
);
--> statement-breakpoint
CREATE TABLE "media_storage_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"provider_type" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_storage_preferences_provider_check" CHECK ("media_storage_preferences"."provider_type" in ('local', 'picbed'))
);
--> statement-breakpoint
ALTER TABLE "character_profile_images" DROP CONSTRAINT "character_profile_images_provider_check";--> statement-breakpoint
ALTER TABLE "local_media_objects" ADD CONSTRAINT "local_media_objects_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_storage_preferences" ADD CONSTRAINT "media_storage_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "local_media_objects_owner_created_idx" ON "local_media_objects" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "character_profile_images" ADD CONSTRAINT "character_profile_images_provider_check" CHECK ("character_profile_images"."storage_provider" in ('picbed', 'external', 'local'));