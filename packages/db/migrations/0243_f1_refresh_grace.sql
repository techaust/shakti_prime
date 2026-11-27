ALTER TABLE "mobile_devices" ADD COLUMN "previous_refresh_token_hash" text;--> statement-breakpoint
ALTER TABLE "mobile_devices" ADD COLUMN "refresh_rotated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_previous_hash_check" CHECK ("mobile_devices"."previous_refresh_token_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_rotation_pair_check" CHECK (("mobile_devices"."previous_refresh_token_hash" is null) = ("mobile_devices"."refresh_rotated_at" is null));