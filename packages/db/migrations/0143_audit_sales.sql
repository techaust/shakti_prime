ALTER TABLE "quotes" DROP CONSTRAINT "quotes_withdrawn_reason_check";--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "withdrawn_for_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "account_type" text;--> statement-breakpoint
-- An order made before the snapshot takes its customer's type as it stands now (DOM-1). The
-- backfill leaves updated_at as it was: it records no one's change.
ALTER TABLE "sales_orders" DISABLE TRIGGER "set_updated_at";--> statement-breakpoint
UPDATE "sales_orders" so SET "account_type" = a."type" FROM "accounts" a WHERE a."id" = so."account_id";--> statement-breakpoint
ALTER TABLE "sales_orders" ENABLE TRIGGER "set_updated_at";--> statement-breakpoint
ALTER TABLE "sales_orders" ALTER COLUMN "account_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_withdrawn_for_fk" FOREIGN KEY ("withdrawn_for_id","entity_id") REFERENCES "public"."quotes"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_opportunity_accepted_unique" ON "quotes" USING btree ("opportunity_id") WHERE "quotes"."state" = 'accepted';--> statement-breakpoint
CREATE INDEX "quotes_withdrawn_for_idx" ON "quotes" USING btree ("withdrawn_for_id") WHERE "quotes"."withdrawn_for_id" is not null;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_withdrawn_reason_check" CHECK (("quotes"."state" = 'withdrawn') = ("quotes"."withdrawn_reason" is not null or "quotes"."withdrawn_for_id" is not null)
       and ("quotes"."withdrawn_reason" is null or "quotes"."withdrawn_for_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_account_type_check" CHECK ("sales_orders"."account_type" in ('household', 'farm', 'business', 'dealer', 'referral_partner'));