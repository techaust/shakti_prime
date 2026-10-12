ALTER TABLE "accounts" ADD COLUMN "anonymised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "anonymised_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "opportunities_retention_idx" ON "opportunities" USING btree ("entity_id","updated_at","id") WHERE "opportunities"."anonymised_at" is null and "opportunities"."state" <> 'won';