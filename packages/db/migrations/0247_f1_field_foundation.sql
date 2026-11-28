CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"entity_id" smallint,
	"enabled" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "feature_flags_key_entity_unique" UNIQUE NULLS NOT DISTINCT("key","entity_id"),
	CONSTRAINT "feature_flags_key_check" CHECK ("feature_flags"."key" ~ '^[a-z][a-z0-9_.]{1,63}$')
);
--> statement-breakpoint
CREATE TABLE "mobile_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"platform" text DEFAULT 'android' NOT NULL,
	"name" text,
	"os_version" text,
	"app_version" text NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"refresh_family_id" uuid NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"signed_in_at" timestamp with time zone NOT NULL,
	"push_token" text,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mobile_devices_user_device_unique" UNIQUE("user_id","device_id"),
	CONSTRAINT "mobile_devices_refresh_token_hash_unique" UNIQUE("refresh_token_hash"),
	CONSTRAINT "mobile_devices_platform_check" CHECK ("mobile_devices"."platform" in ('android')),
	CONSTRAINT "mobile_devices_name_length_check" CHECK (char_length("mobile_devices"."name") between 1 and 80),
	CONSTRAINT "mobile_devices_os_version_length_check" CHECK (char_length("mobile_devices"."os_version") between 1 and 20),
	CONSTRAINT "mobile_devices_app_version_check" CHECK ("mobile_devices"."app_version" ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}$'),
	CONSTRAINT "mobile_devices_refresh_token_hash_check" CHECK ("mobile_devices"."refresh_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "mobile_devices_push_token_length_check" CHECK (char_length("mobile_devices"."push_token") between 1 and 4096),
	CONSTRAINT "mobile_devices_revoked_reason_check" CHECK ("mobile_devices"."revoked_reason" in ('signed_out', 'revoked', 'refresh_reused')),
	CONSTRAINT "mobile_devices_revoked_pair_check" CHECK (("mobile_devices"."revoked_at" is null) = ("mobile_devices"."revoked_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_revoked_by_principals_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feature_flags_entity_idx" ON "feature_flags" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_devices_live_device_idx" ON "mobile_devices" USING btree ("device_id") WHERE "mobile_devices"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "mobile_devices_revoked_by_idx" ON "mobile_devices" USING btree ("revoked_by");