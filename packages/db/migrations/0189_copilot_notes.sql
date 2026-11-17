CREATE TABLE "copilot_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"provider_call_id" uuid,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"fields_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"suggested_disposition_id" uuid,
	"agent_action_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "copilot_notes_kind_check" CHECK ("copilot_notes"."kind" in ('brief', 'call_summary')),
	CONSTRAINT "copilot_notes_body_check" CHECK (char_length("copilot_notes"."body") between 1 and 600),
	CONSTRAINT "copilot_notes_call_check" CHECK (("copilot_notes"."kind" <> 'call_summary') = ("copilot_notes"."provider_call_id" is null)),
	CONSTRAINT "copilot_notes_brief_check" CHECK ("copilot_notes"."kind" <> 'brief' or ("copilot_notes"."suggested_disposition_id" is null and "copilot_notes"."fields_json" = '{}'::jsonb)),
	CONSTRAINT "copilot_notes_fields_check" CHECK (jsonb_typeof("copilot_notes"."fields_json") = 'object' and pg_column_size("copilot_notes"."fields_json") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "agent_runs" DROP CONSTRAINT "agent_runs_filter_reason_check";--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_purpose_check";--> statement-breakpoint
ALTER TABLE "copilot_notes" ADD CONSTRAINT "copilot_notes_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_notes" ADD CONSTRAINT "copilot_notes_provider_call_id_provider_calls_id_fk" FOREIGN KEY ("provider_call_id") REFERENCES "public"."provider_calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_notes" ADD CONSTRAINT "copilot_notes_suggested_disposition_id_call_dispositions_id_fk" FOREIGN KEY ("suggested_disposition_id") REFERENCES "public"."call_dispositions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_notes" ADD CONSTRAINT "copilot_notes_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_notes" ADD CONSTRAINT "copilot_notes_opportunity_fk" FOREIGN KEY ("opportunity_id","entity_id") REFERENCES "public"."opportunities"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_notes" ADD CONSTRAINT "copilot_notes_agent_action_fk" FOREIGN KEY ("agent_action_id","entity_id") REFERENCES "public"."agent_actions"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "copilot_notes_call_unique" ON "copilot_notes" USING btree ("provider_call_id") WHERE "copilot_notes"."provider_call_id" is not null;--> statement-breakpoint
CREATE INDEX "copilot_notes_opportunity_idx" ON "copilot_notes" USING btree ("opportunity_id","kind","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "copilot_notes_agent_action_idx" ON "copilot_notes" USING btree ("agent_action_id") WHERE "copilot_notes"."agent_action_id" is not null;--> statement-breakpoint
CREATE INDEX "copilot_notes_entity_created_idx" ON "copilot_notes" USING btree ("entity_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "copilot_notes"."kind" = 'call_summary';--> statement-breakpoint
CREATE INDEX "copilot_notes_disposition_idx" ON "copilot_notes" USING btree ("suggested_disposition_id") WHERE "copilot_notes"."suggested_disposition_id" is not null;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_filter_reason_check" CHECK ("agent_runs"."filter_reason" in ('unreadable_answer', 'unknown_pipeline', 'score_out_of_bounds', 'unknown_candidate', 'unknown_person', 'text_has_phone', 'text_has_identity_number', 'text_has_instruction', 'text_too_long', 'fact_out_of_bounds', 'task_outside_hours', 'template_not_allowed', 'unknown_outcome')) NOT VALID;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_check" CHECK ("files"."purpose" in ('job_photo', 'survey_photo', 'qc_photo', 'receipt', 'signature', 'selfie', 'customer_document', 'import', 'quote_pdf', 'signed_quote', 'entity_logo', 'letterhead', 'print_proof', 'knowledge', 'consent_evidence', 'call_recording', 'whatsapp_media', 'call_transcript')) NOT VALID;