-- S3 (docs/03-roadmap-appendix/phase2.md §7.1): the notices of a quote accepted and of a press on a lapsed
-- quote on WhatsApp. Each list only widens, so the checks are added NOT VALID: every row that met
-- the narrower list meets the wider one (migration-rules.test.ts).
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_type_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_type_check" CHECK ("notification_preferences"."type" is null or "notification_preferences"."type" in ('lead_assigned', 'duplicate_found', 'call_due', 'quote_expiring', 'first_call_late', 'enquiry_routed', 'order_credit_held', 'whatsapp_reply_waiting', 'quote_accepted', 'whatsapp_quote_expired')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('lead_assigned', 'duplicate_found', 'call_due', 'quote_expiring', 'first_call_late', 'enquiry_routed', 'order_credit_held', 'whatsapp_reply_waiting', 'quote_accepted', 'whatsapp_quote_expired')) NOT VALID;
