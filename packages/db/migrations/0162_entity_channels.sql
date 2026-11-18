CREATE TABLE "entity_channels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"channel" text NOT NULL,
	"number_e164" text NOT NULL,
	"provider_ref" text,
	"dlt_header" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "entity_channels_channel_check" CHECK ("entity_channels"."channel" in ('whatsapp', 'call_promo_140', 'call_service_160', 'ivr', 'missed_call')),
	CONSTRAINT "entity_channels_number_e164_check" CHECK ("entity_channels"."number_e164" ~ '^\+[1-9]\d{6,14}$'),
	CONSTRAINT "entity_channels_provider_ref_check" CHECK ("entity_channels"."provider_ref" is null or "entity_channels"."provider_ref" ~ '^[A-Za-z0-9_.:-]{1,64}$'),
	CONSTRAINT "entity_channels_dlt_header_check" CHECK ("entity_channels"."dlt_header" is null or char_length("entity_channels"."dlt_header") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "entity_channels" ADD CONSTRAINT "entity_channels_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_channels" ADD CONSTRAINT "entity_channels_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_channels" ADD CONSTRAINT "entity_channels_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_channels_active_unique" ON "entity_channels" USING btree ("entity_id","channel") WHERE "entity_channels"."is_active";--> statement-breakpoint
CREATE UNIQUE INDEX "entity_channels_provider_ref_unique" ON "entity_channels" USING btree ("provider_ref") WHERE "entity_channels"."is_active" and "entity_channels"."provider_ref" is not null;