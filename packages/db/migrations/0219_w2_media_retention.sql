ALTER TABLE "whatsapp_messages" ADD COLUMN "media_summary" jsonb;--> statement-breakpoint
CREATE INDEX "whatsapp_messages_media_kept_idx" ON "whatsapp_messages" USING btree ("entity_id","created_at","id") WHERE "kind" = 'media' and "file_id" is not null and "media_summary" is null;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_media_summary_check" CHECK ("media_summary" is null
          or (jsonb_typeof("media_summary") = 'object' and "kind" = 'media'
              and "file_id" is not null and octet_length("media_summary"::text) <= 1000));