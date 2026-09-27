CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "outbox_events_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_id" smallint NOT NULL,
	"type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"dead_lettered_at" timestamp with time zone,
	CONSTRAINT "outbox_events_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "outbox_events_type_check" CHECK ("outbox_events"."type" ~ '^[a-z]+(\.[a-z_]+)+$'),
	CONSTRAINT "outbox_events_attempts_check" CHECK ("outbox_events"."attempts" >= 0),
	CONSTRAINT "outbox_events_last_error_length_check" CHECK (char_length("outbox_events"."last_error") <= 500),
	CONSTRAINT "outbox_events_payload_version_check" CHECK ("outbox_events"."payload_json" ? 'v')
);
--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" USING btree ("sequence") WHERE "outbox_events"."published_at" is null and "outbox_events"."dead_lettered_at" is null;