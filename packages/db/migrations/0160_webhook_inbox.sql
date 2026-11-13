CREATE TABLE "webhook_inbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signature_ok" boolean DEFAULT true NOT NULL,
	"payload_json" jsonb,
	"payload_sha256" text NOT NULL,
	"entity_id" smallint,
	"claimed_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"error_code" text,
	"payload_purged_at" timestamp with time zone,
	CONSTRAINT "webhook_inbox_provider_event_unique" UNIQUE("provider","provider_event_id"),
	CONSTRAINT "webhook_inbox_provider_check" CHECK ("webhook_inbox"."provider" in ('meta_whatsapp', 'meta_leadgen', 'google_leadform', 'exotel_status', 'exotel_incoming', 'livekit')),
	CONSTRAINT "webhook_inbox_event_id_check" CHECK (char_length("webhook_inbox"."provider_event_id") between 1 and 200),
	CONSTRAINT "webhook_inbox_signature_check" CHECK ("webhook_inbox"."signature_ok"),
	CONSTRAINT "webhook_inbox_sha256_check" CHECK ("webhook_inbox"."payload_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "webhook_inbox_attempts_check" CHECK ("webhook_inbox"."attempts" >= 0),
	CONSTRAINT "webhook_inbox_error_code_check" CHECK ("webhook_inbox"."error_code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "webhook_inbox_outcome_check" CHECK ("webhook_inbox"."processed_at" is null or "webhook_inbox"."failed_at" is null),
	CONSTRAINT "webhook_inbox_purge_check" CHECK (("webhook_inbox"."payload_json" is null) = ("webhook_inbox"."payload_purged_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "webhook_inbox" ADD CONSTRAINT "webhook_inbox_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_inbox_waiting_idx" ON "webhook_inbox" USING btree ("received_at") WHERE "webhook_inbox"."processed_at" is null and "webhook_inbox"."failed_at" is null;--> statement-breakpoint
CREATE INDEX "webhook_inbox_failed_idx" ON "webhook_inbox" USING btree ("failed_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "webhook_inbox"."failed_at" is not null;--> statement-breakpoint
CREATE INDEX "webhook_inbox_provider_processed_idx" ON "webhook_inbox" USING btree ("provider","processed_at") WHERE "webhook_inbox"."processed_at" is not null;--> statement-breakpoint
CREATE INDEX "webhook_inbox_purge_idx" ON "webhook_inbox" USING btree ("processed_at") WHERE "webhook_inbox"."processed_at" is not null and "webhook_inbox"."payload_json" is not null;--> statement-breakpoint
CREATE INDEX "webhook_inbox_provider_received_idx" ON "webhook_inbox" USING btree ("provider","received_at");--> statement-breakpoint
CREATE INDEX "webhook_inbox_received_idx" ON "webhook_inbox" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "webhook_inbox_entity_idx" ON "webhook_inbox" USING btree ("entity_id") WHERE "webhook_inbox"."entity_id" is not null;