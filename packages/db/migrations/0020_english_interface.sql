ALTER TABLE "contacts" DROP CONSTRAINT "contacts_preferred_language_check";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_locale_check";--> statement-breakpoint
DROP INDEX "contacts_search_roman_trgm_idx";--> statement-breakpoint
ALTER TABLE "contacts" ALTER COLUMN "preferred_language" SET DEFAULT 'hinglish';--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "name_hi";--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "name_hi";--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "search_roman";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "name_hi";--> statement-breakpoint
ALTER TABLE "kits" DROP COLUMN "name_hi";--> statement-breakpoint
ALTER TABLE "lead_sources" DROP COLUMN "name_hi";--> statement-breakpoint
ALTER TABLE "pipeline_stages" DROP COLUMN "name_hi";--> statement-breakpoint
ALTER TABLE "pipelines" DROP COLUMN "name_hi";--> statement-breakpoint
ALTER TABLE "price_tiers" DROP COLUMN "name_hi";--> statement-breakpoint
ALTER TABLE "roles" DROP COLUMN "name_hi";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "locale";--> statement-breakpoint
-- Customers recorded before ADR 0014 were Hindi by default; they now take Hinglish calls.
UPDATE "contacts" SET "preferred_language" = 'hinglish' WHERE "preferred_language" = 'hi';--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_preferred_language_check" CHECK ("contacts"."preferred_language" in ('hinglish', 'en'));