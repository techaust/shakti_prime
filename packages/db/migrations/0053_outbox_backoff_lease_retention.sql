CREATE TABLE "retention_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"rows_affected" integer,
	"error" text,
	CONSTRAINT "retention_runs_job_check" CHECK ("retention_runs"."job" ~ '^[a-z]+(-[a-z]+)*$'),
	CONSTRAINT "retention_runs_rows_affected_check" CHECK ("retention_runs"."rows_affected" >= 0),
	CONSTRAINT "retention_runs_error_length_check" CHECK (char_length("retention_runs"."error") <= 500)
);
--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "claimed_until" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "retention_runs_job_started_idx" ON "retention_runs" USING btree ("job","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "outbox_events_dead_letters_idx" ON "outbox_events" USING btree ("dead_lettered_at") WHERE "outbox_events"."dead_lettered_at" is not null;