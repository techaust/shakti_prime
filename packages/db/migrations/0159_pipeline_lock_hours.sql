ALTER TABLE "pipelines" ALTER COLUMN "lock_hours" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "pipelines" ALTER COLUMN "lock_hours" DROP NOT NULL;