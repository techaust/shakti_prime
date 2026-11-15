CREATE TABLE "provider_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"contact_phone_id" uuid,
	"caller_id" uuid,
	"direction" text NOT NULL,
	"series" text NOT NULL,
	"purpose" text,
	"provider_call_sid" text,
	"status" text DEFAULT 'dialling' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_s" integer,
	"recording_file_id" uuid,
	"transcript_file_id" uuid,
	"call_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_calls_direction_check" CHECK ("provider_calls"."direction" in ('outbound', 'inbound')),
	CONSTRAINT "provider_calls_series_check" CHECK ("provider_calls"."series" in ('140', '160', 'ivr', 'missed_call')),
	CONSTRAINT "provider_calls_purpose_check" CHECK ("provider_calls"."purpose" is null or "provider_calls"."purpose" in ('promotional', 'service')),
	CONSTRAINT "provider_calls_status_check" CHECK ("provider_calls"."status" in ('dialling', 'ringing', 'in_progress', 'completed', 'no_answer', 'busy', 'failed', 'canceled')),
	CONSTRAINT "provider_calls_outbound_check" CHECK ("provider_calls"."direction" <> 'outbound' or ("provider_calls"."caller_id" is not null and "provider_calls"."contact_phone_id" is not null and "provider_calls"."purpose" is not null and "provider_calls"."series" in ('140', '160'))),
	CONSTRAINT "provider_calls_sid_check" CHECK ("provider_calls"."provider_call_sid" is null or "provider_calls"."provider_call_sid" ~ '^[A-Za-z0-9_.:-]{1,80}$'),
	CONSTRAINT "provider_calls_duration_check" CHECK ("provider_calls"."duration_s" is null or "provider_calls"."duration_s" between 0 and 14400)
);
--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_purpose_check";--> statement-breakpoint
ALTER TABLE "caller_profiles" ADD COLUMN "dial_phone_e164" text;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD CONSTRAINT "provider_calls_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD CONSTRAINT "provider_calls_contact_phone_id_contact_phones_id_fk" FOREIGN KEY ("contact_phone_id") REFERENCES "public"."contact_phones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD CONSTRAINT "provider_calls_caller_id_principals_id_fk" FOREIGN KEY ("caller_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD CONSTRAINT "provider_calls_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD CONSTRAINT "provider_calls_opportunity_entity_fk" FOREIGN KEY ("opportunity_id","entity_id") REFERENCES "public"."opportunities"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD CONSTRAINT "provider_calls_recording_entity_fk" FOREIGN KEY ("recording_file_id","entity_id") REFERENCES "public"."files"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD CONSTRAINT "provider_calls_transcript_entity_fk" FOREIGN KEY ("transcript_file_id","entity_id") REFERENCES "public"."files"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_calls_sid_unique" ON "provider_calls" USING btree ("provider_call_sid");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_calls_call_unique" ON "provider_calls" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "provider_calls_opportunity_started_idx" ON "provider_calls" USING btree ("opportunity_id","started_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "provider_calls_caller_started_idx" ON "provider_calls" USING btree ("caller_id","started_at");--> statement-breakpoint
CREATE INDEX "provider_calls_contact_phone_idx" ON "provider_calls" USING btree ("contact_phone_id");--> statement-breakpoint
CREATE INDEX "provider_calls_recording_idx" ON "provider_calls" USING btree ("recording_file_id") WHERE "provider_calls"."recording_file_id" is not null;--> statement-breakpoint
CREATE INDEX "provider_calls_transcript_idx" ON "provider_calls" USING btree ("transcript_file_id") WHERE "provider_calls"."transcript_file_id" is not null;--> statement-breakpoint
CREATE INDEX "files_call_recording_kept_idx" ON "files" USING btree ("created_at") WHERE "files"."purpose" = 'call_recording' and "files"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "caller_profiles" ADD CONSTRAINT "caller_profiles_dial_phone_check" CHECK ("caller_profiles"."dial_phone_e164" is null or "caller_profiles"."dial_phone_e164" ~ '^\+[1-9]\d{6,14}$');--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_check" CHECK ("files"."purpose" in ('job_photo', 'survey_photo', 'qc_photo', 'receipt', 'signature', 'selfie', 'customer_document', 'import', 'quote_pdf', 'signed_quote', 'entity_logo', 'letterhead', 'print_proof', 'knowledge', 'consent_evidence', 'call_recording')) NOT VALID;