-- S3 fix round (docs/03-roadmap-appendix/phase2.md §7.1): what a template's header takes when it
-- is sent (nothing, or a document such as a quote's PDF), so a milestone is mapped only to a
-- template the platform can send; and the notice of a quote marked sent on WhatsApp that did not
-- go. The notice lists only widen, so their checks are added NOT VALID (migration-rules.test.ts);
-- the header's check is new, on a column every row takes its default for.
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_type_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD COLUMN "header" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_type_check" CHECK ("notification_preferences"."type" is null or "notification_preferences"."type" in ('lead_assigned', 'duplicate_found', 'call_due', 'quote_expiring', 'first_call_late', 'enquiry_routed', 'order_credit_held', 'whatsapp_reply_waiting', 'quote_accepted', 'whatsapp_quote_expired', 'whatsapp_quote_not_sent')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('lead_assigned', 'duplicate_found', 'call_due', 'quote_expiring', 'first_call_late', 'enquiry_routed', 'order_credit_held', 'whatsapp_reply_waiting', 'quote_accepted', 'whatsapp_quote_expired', 'whatsapp_quote_not_sent')) NOT VALID;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_header_check" CHECK ("whatsapp_templates"."header" in ('none', 'document'));