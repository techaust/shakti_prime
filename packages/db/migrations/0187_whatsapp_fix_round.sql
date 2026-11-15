ALTER TABLE "whatsapp_threads" DROP CONSTRAINT "whatsapp_threads_wa_id_check";--> statement-breakpoint
ALTER TABLE "whatsapp_threads" DROP CONSTRAINT "whatsapp_threads_handoff_reason_check";--> statement-breakpoint
ALTER TABLE "whatsapp_threads" DROP CONSTRAINT "whatsapp_threads_contact_phone_id_contact_phones_id_fk";
--> statement-breakpoint
ALTER TABLE "whatsapp_threads" ALTER COLUMN "wa_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD COLUMN "label" text;--> statement-breakpoint
UPDATE "whatsapp_templates" SET "label" = "name";--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ALTER COLUMN "label" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_threads" ADD COLUMN "welcomed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatsapp_threads" ADD CONSTRAINT "whatsapp_threads_contact_phone_id_contact_phones_id_fk" FOREIGN KEY ("contact_phone_id") REFERENCES "public"."contact_phones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_threads_wa_idx" ON "whatsapp_threads" USING btree ("wa_id");--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_label_check" CHECK (char_length(btrim("whatsapp_templates"."label")) between 1 and 60);--> statement-breakpoint
ALTER TABLE "whatsapp_threads" ADD CONSTRAINT "whatsapp_threads_wa_id_check" CHECK ("whatsapp_threads"."wa_id" is null or "whatsapp_threads"."wa_id" ~ '^[1-9][0-9]{6,14}$') NOT VALID;--> statement-breakpoint
ALTER TABLE "whatsapp_threads" ADD CONSTRAINT "whatsapp_threads_handoff_reason_check" CHECK ("whatsapp_threads"."handoff_reason" is null or "whatsapp_threads"."handoff_reason" in ('keyword', 'request', 'filter_refusals', 'complaint', 'no_assistant')) NOT VALID;