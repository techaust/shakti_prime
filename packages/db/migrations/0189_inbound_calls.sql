-- T4 Inbound calls and screen-pop (docs/03-roadmap-appendix/phase2.md §7.4): an inbound call
-- through the IVR is recorded before anyone knows which lead it is about, so a provider call's lead
-- is required only of a dial and a missed call; and the missed-call notice. The notice lists only
-- widen, so they are added NOT VALID (migration-rules.test.ts); every provider call so far is a
-- dial with its lead, so the two new checks hold for every row.
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_type_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "provider_calls" ALTER COLUMN "opportunity_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_type_check" CHECK ("notification_preferences"."type" is null or "notification_preferences"."type" in ('lead_assigned', 'duplicate_found', 'call_due', 'quote_expiring', 'first_call_late', 'enquiry_routed', 'order_credit_held', 'whatsapp_reply_waiting', 'missed_call')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('lead_assigned', 'duplicate_found', 'call_due', 'quote_expiring', 'first_call_late', 'enquiry_routed', 'order_credit_held', 'whatsapp_reply_waiting', 'missed_call')) NOT VALID;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD CONSTRAINT "provider_calls_outbound_lead_check" CHECK ("provider_calls"."direction" <> 'outbound' or "provider_calls"."opportunity_id" is not null);--> statement-breakpoint
ALTER TABLE "provider_calls" ADD CONSTRAINT "provider_calls_inbound_check" CHECK ("provider_calls"."direction" <> 'inbound' or ("provider_calls"."series" in ('ivr', 'missed_call') and "provider_calls"."purpose" is null and ("provider_calls"."series" <> 'missed_call' or "provider_calls"."opportunity_id" is not null)));
