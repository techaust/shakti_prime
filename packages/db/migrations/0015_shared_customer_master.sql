-- Shared customer master (ADR 0008): contacts and accounts lose their entity and owner; the
-- relationship with each entity moves to account_entities. Local databases hold fixtures only.
-- The policies of 0005 and 0010 reference the columns dropped below, so they go first;
-- 0016 creates their replacements.
drop policy accounts_read on accounts;
--> statement-breakpoint
drop policy accounts_insert on accounts;
--> statement-breakpoint
drop policy accounts_update on accounts;
--> statement-breakpoint
drop policy contacts_read on contacts;
--> statement-breakpoint
drop policy contacts_insert on contacts;
--> statement-breakpoint
drop policy contacts_update on contacts;
--> statement-breakpoint
drop policy account_contacts_read on account_contacts;
--> statement-breakpoint
drop policy account_contacts_insert on account_contacts;
--> statement-breakpoint
drop policy account_contacts_update on account_contacts;
--> statement-breakpoint
drop policy customer_sites_read on customer_sites;
--> statement-breakpoint
drop policy customer_sites_insert on customer_sites;
--> statement-breakpoint
drop policy customer_sites_update on customer_sites;
--> statement-breakpoint
drop policy contact_phones_read on contact_phones;
--> statement-breakpoint
drop policy contact_phones_insert on contact_phones;
--> statement-breakpoint
drop policy contact_phones_update on contact_phones;
--> statement-breakpoint
drop policy consents_read on consents;
--> statement-breakpoint
drop policy consents_insert on consents;
--> statement-breakpoint
drop policy consents_update on consents;
--> statement-breakpoint
CREATE TABLE "account_entities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"entity_id" smallint NOT NULL,
	"owner_id" uuid,
	"team_id" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "account_entities_account_entity_key" UNIQUE("account_id","entity_id")
);
--> statement-breakpoint
ALTER TABLE "account_contacts" DROP CONSTRAINT "account_contacts_entity_id_entities_id_fk";
--> statement-breakpoint
ALTER TABLE "account_contacts" DROP CONSTRAINT "account_contacts_account_entity_fk";
--> statement-breakpoint
ALTER TABLE "account_contacts" DROP CONSTRAINT "account_contacts_contact_entity_fk";
--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_entity_id_entities_id_fk";
--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_owner_id_principals_id_fk";
--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "consents" DROP CONSTRAINT "consents_entity_id_entities_id_fk";
--> statement-breakpoint
ALTER TABLE "consents" DROP CONSTRAINT "consents_contact_entity_fk";
--> statement-breakpoint
ALTER TABLE "contact_phones" DROP CONSTRAINT "contact_phones_entity_id_entities_id_fk";
--> statement-breakpoint
ALTER TABLE "contact_phones" DROP CONSTRAINT "contact_phones_contact_entity_fk";
--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_entity_id_entities_id_fk";
--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_owner_id_principals_id_fk";
--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "customer_sites" DROP CONSTRAINT "customer_sites_entity_id_entities_id_fk";
--> statement-breakpoint
ALTER TABLE "customer_sites" DROP CONSTRAINT "customer_sites_account_entity_fk";
--> statement-breakpoint
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_account_entity_fk";
--> statement-breakpoint
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_site_entity_fk";
--> statement-breakpoint
-- the composite foreign keys above depended on these keys, so they go second
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_id_entity_unique";--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_id_entity_unique";--> statement-breakpoint
ALTER TABLE "customer_sites" DROP CONSTRAINT "customer_sites_id_entity_unique";--> statement-breakpoint
DROP INDEX "accounts_entity_owner_idx";--> statement-breakpoint
DROP INDEX "accounts_entity_team_idx";--> statement-breakpoint
DROP INDEX "contacts_entity_owner_idx";--> statement-breakpoint
DROP INDEX "contacts_entity_team_idx";--> statement-breakpoint
ALTER TABLE "account_entities" ADD CONSTRAINT "account_entities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_entities" ADD CONSTRAINT "account_entities_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_entities" ADD CONSTRAINT "account_entities_owner_id_principals_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_entities" ADD CONSTRAINT "account_entities_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_entities" ADD CONSTRAINT "account_entities_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_entities" ADD CONSTRAINT "account_entities_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_entities_entity_owner_idx" ON "account_entities" USING btree ("entity_id","owner_id");--> statement-breakpoint
CREATE INDEX "account_entities_entity_team_idx" ON "account_entities" USING btree ("entity_id","team_id");--> statement-breakpoint
ALTER TABLE "account_contacts" DROP COLUMN "entity_id";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "entity_id";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "owner_id";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "consents" DROP COLUMN "entity_id";--> statement-breakpoint
ALTER TABLE "contact_phones" DROP COLUMN "entity_id";--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "entity_id";--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "owner_id";--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "customer_sites" DROP COLUMN "entity_id";