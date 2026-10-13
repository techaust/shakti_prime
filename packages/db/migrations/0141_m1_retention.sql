ALTER TABLE "accounts" ADD COLUMN "anonymised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "anonymised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "qualified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "retention_kept_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "retention_kept_reason" text;--> statement-breakpoint
CREATE INDEX "agent_actions_opportunity_idx" ON "agent_actions" USING btree (("input_json" ->> 'opportunityId'));--> statement-breakpoint
CREATE INDEX "audit_logs_input_account_idx" ON "audit_logs" USING btree (("input_json" ->> 'accountId')) WHERE "audit_logs"."input_json" ? 'accountId';--> statement-breakpoint
CREATE INDEX "audit_logs_input_opportunity_idx" ON "audit_logs" USING btree (("input_json" ->> 'opportunityId')) WHERE "audit_logs"."input_json" ? 'opportunityId';--> statement-breakpoint
CREATE INDEX "audit_logs_input_proposal_opportunity_idx" ON "audit_logs" USING btree (("input_json" #>> '{proposal,input,opportunityId}')) WHERE "audit_logs"."input_json" ? 'proposal';--> statement-breakpoint
CREATE INDEX "audit_logs_input_existing_account_idx" ON "audit_logs" USING btree (("input_json" ->> 'existingAccountId')) WHERE "audit_logs"."input_json" ? 'existingAccountId';--> statement-breakpoint
CREATE INDEX "inbox_items_subject_idx" ON "inbox_items" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "opportunities_retention_idx" ON "opportunities" USING btree ("entity_id","updated_at","id") WHERE "opportunities"."anonymised_at" is null and "opportunities"."retention_kept_at" is null and "opportunities"."state" <> 'won';--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_retention_kept_reason_check" CHECK ("opportunities"."retention_kept_reason" is null or "opportunities"."retention_kept_reason" in ('won', 'qualified', 'quote', 'order', 'commission', 'dealer_credit', 'referral_partner', 'other_lead', 'customer', 'dealer', 'merge'));--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_retention_kept_check" CHECK (("opportunities"."retention_kept_at" is null) = ("opportunities"."retention_kept_reason" is null));