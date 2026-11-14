ALTER TABLE "provider_calls" DROP CONSTRAINT "provider_calls_outbound_check";--> statement-breakpoint
ALTER TABLE "provider_calls" DROP CONSTRAINT "provider_calls_contact_phone_id_contact_phones_id_fk";
--> statement-breakpoint
DROP INDEX "provider_calls_unplaced_idx";--> statement-breakpoint
ALTER TABLE "provider_calls" ADD CONSTRAINT "provider_calls_contact_phone_id_contact_phones_id_fk" FOREIGN KEY ("contact_phone_id") REFERENCES "public"."contact_phones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_calls_open_idx" ON "provider_calls" USING btree ("started_at") WHERE "provider_calls"."status" in ('dialling', 'ringing', 'in_progress');--> statement-breakpoint
ALTER TABLE "provider_calls" ADD CONSTRAINT "provider_calls_outbound_check" CHECK ("provider_calls"."direction" <> 'outbound' or ("provider_calls"."caller_id" is not null and "provider_calls"."purpose" is not null and "provider_calls"."series" in ('140', '160'))) NOT VALID;