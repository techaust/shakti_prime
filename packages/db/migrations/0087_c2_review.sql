-- A lead's tags carry the lead's customer, as its tasks do, so both refer to the one three-column
-- unique key of opportunities and the two-column key goes. The statements are ordered by hand:
-- the old foreign key goes before the key it uses, and the column is filled before it is required.
-- On a hosted database with many leads, an index of opportunities is built with the concurrent
-- index procedure of docs/runbooks/DEPLOY.md §3 rather than inside this migration.
ALTER TABLE "opportunity_tags" DROP CONSTRAINT "opportunity_tags_opportunity_fk";--> statement-breakpoint
ALTER TABLE "opportunity_tags" ADD COLUMN "account_id" uuid;--> statement-breakpoint
-- The owner fills the column past the policies, which it is otherwise held to (FORCE).
ALTER TABLE "opportunity_tags" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "opportunities" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "opportunity_tags" ot SET "account_id" = o."account_id" FROM "opportunities" o WHERE o."id" = ot."opportunity_id";--> statement-breakpoint
ALTER TABLE "opportunities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "opportunity_tags" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "opportunity_tags" ALTER COLUMN "account_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunity_tags" ADD CONSTRAINT "opportunity_tags_opportunity_fk" FOREIGN KEY ("opportunity_id","entity_id","account_id") REFERENCES "public"."opportunities"("id","entity_id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_id_entity_unique";
