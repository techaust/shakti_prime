ALTER TABLE "accounts" ADD COLUMN "anonymised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "anonymised_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "agent_actions_opportunity_idx" ON "agent_actions" USING btree (("input_json" ->> 'opportunityId'));--> statement-breakpoint
CREATE INDEX "inbox_items_subject_idx" ON "inbox_items" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "opportunities_retention_idx" ON "opportunities" USING btree ("entity_id","updated_at","id") WHERE "opportunities"."anonymised_at" is null and "opportunities"."state" <> 'won';