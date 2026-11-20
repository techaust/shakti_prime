ALTER TABLE "retention_runs" ADD COLUMN "entity_id" smallint;--> statement-breakpoint
ALTER TABLE "retention_runs" ADD COLUMN "resume_key" text;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD COLUMN "media_summary" jsonb;--> statement-breakpoint
ALTER TABLE "retention_runs" ADD CONSTRAINT "retention_runs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_messages_media_kept_idx" ON "whatsapp_messages" USING btree ("entity_id","created_at","id") WHERE "kind" = 'media' and "file_id" is not null and "media_summary" is null;--> statement-breakpoint
ALTER TABLE "retention_runs" ADD CONSTRAINT "retention_runs_resume_key_length_check" CHECK (char_length("retention_runs"."resume_key") <= 300);--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_media_summary_check" CHECK ("media_summary" is null
          or (jsonb_typeof("media_summary") = 'object' and "kind" = 'media'
              and "file_id" is not null and octet_length("media_summary"::text) <= 1000));