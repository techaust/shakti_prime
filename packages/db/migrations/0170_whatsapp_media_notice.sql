-- W1 (docs/03-roadmap-appendix/phase2.md §6.1): a file a customer sends on WhatsApp, and the notice of a
-- WhatsApp chat waiting for a reply. Each list only widens, so the checks are added NOT VALID: every
-- row that met the narrower list meets the wider one (migration-rules.test.ts).
ALTER TABLE "files" DROP CONSTRAINT "files_purpose_check";--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_type_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_subject_type_check";--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_check" CHECK ("files"."purpose" in ('job_photo', 'survey_photo', 'qc_photo', 'receipt', 'signature', 'selfie', 'customer_document', 'import', 'quote_pdf', 'signed_quote', 'entity_logo', 'letterhead', 'print_proof', 'knowledge', 'consent_evidence', 'whatsapp_media')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_type_check" CHECK ("notification_preferences"."type" is null or "notification_preferences"."type" in ('lead_assigned', 'duplicate_found', 'call_due', 'quote_expiring', 'first_call_late', 'enquiry_routed', 'order_credit_held', 'whatsapp_reply_waiting')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('lead_assigned', 'duplicate_found', 'call_due', 'quote_expiring', 'first_call_late', 'enquiry_routed', 'order_credit_held', 'whatsapp_reply_waiting')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_subject_type_check" CHECK ("notifications"."subject_type" in ('opportunity', 'duplicate_candidate', 'task', 'quote', 'inbox_item', 'sales_order', 'whatsapp_thread')) NOT VALID;
