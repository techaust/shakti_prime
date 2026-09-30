ALTER TABLE "files" DROP CONSTRAINT "files_purpose_check";--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_status_check";--> statement-breakpoint
CREATE INDEX "files_entity_purpose_created_idx" ON "files" USING btree ("entity_id","purpose","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_check" CHECK ("files"."purpose" in ('job_photo', 'survey_photo', 'qc_photo', 'receipt', 'signature', 'selfie', 'customer_document', 'import', 'quote_pdf', 'signed_quote', 'entity_logo', 'letterhead', 'knowledge', 'consent_evidence'));--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_status_check" CHECK ("files"."status" in ('pending', 'scanning', 'scanned', 'not_scanned', 'masked', 'ready', 'rejected'));