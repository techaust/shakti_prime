-- Partitioned by month (docs/design/backend-weeks-3-5.md §3.1). drizzle-kit cannot emit the
-- PARTITION BY clause, so it was added to the generated statement before the file was applied.
CREATE TABLE "audit_logs" (
	"id" uuid NOT NULL,
	"entity_id" smallint,
	"actor_principal_id" uuid,
	"actor_kind" text,
	"on_behalf_of_user_id" uuid,
	"command" text NOT NULL,
	"aggregate_type" text,
	"aggregate_id" text,
	"outcome" text NOT NULL,
	"error_code" text,
	"input_json" jsonb,
	"before_json" jsonb,
	"after_json" jsonb,
	"ip" "inet",
	"device" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_pkey" PRIMARY KEY("id","created_at"),
	CONSTRAINT "audit_logs_outcome_check" CHECK ("audit_logs"."outcome" in ('ok', 'denied', 'failed')),
	CONSTRAINT "audit_logs_actor_kind_check" CHECK ("audit_logs"."actor_kind" is null or "audit_logs"."actor_kind" in ('user', 'agent', 'voice_session')),
	CONSTRAINT "audit_logs_actor_check" CHECK ("audit_logs"."command" like 'auth.%' or ("audit_logs"."actor_principal_id" is not null and "audit_logs"."actor_kind" is not null)),
	CONSTRAINT "audit_logs_device_length_check" CHECK (char_length("audit_logs"."device") <= 256)
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_principal_id_principals_id_fk" FOREIGN KEY ("actor_principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_on_behalf_of_user_id_principals_id_fk" FOREIGN KEY ("on_behalf_of_user_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_created_idx" ON "audit_logs" USING btree ("entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_aggregate_created_idx" ON "audit_logs" USING btree ("aggregate_type","aggregate_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_actor_created_idx" ON "audit_logs" USING btree ("actor_principal_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_on_behalf_of_idx" ON "audit_logs" USING btree ("on_behalf_of_user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_request_idx" ON "audit_logs" USING btree ("request_id");