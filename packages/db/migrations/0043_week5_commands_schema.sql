ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_state_check";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "billing_state_code" text;--> statement-breakpoint
ALTER TABLE "customer_sites" ADD COLUMN "state_code" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "state_changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "pipelines" ADD COLUMN "lock_hours" smallint DEFAULT 48 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_billing_state_code_check" CHECK ("accounts"."billing_state_code" is null or "accounts"."billing_state_code" ~ '^[0-9]{2}$');--> statement-breakpoint
ALTER TABLE "customer_sites" ADD CONSTRAINT "customer_sites_state_code_check" CHECK ("customer_sites"."state_code" is null or "customer_sites"."state_code" ~ '^[0-9]{2}$');--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_state_check" CHECK ("opportunities"."state" in ('open', 'nurture', 'won', 'lost'));--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_lock_hours_check" CHECK ("pipelines"."lock_hours" between 1 and 720);