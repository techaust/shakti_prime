-- A session's own longest length (V2 fix round, M2): set when it opens. Sessions opened before it
-- had the one longest length of a session, AGENT_DEFAULTS.voice.sessionMaxMinutes (15).
ALTER TABLE "voice_sessions" ADD COLUMN "max_minutes" integer;--> statement-breakpoint
UPDATE "voice_sessions" SET "max_minutes" = 15 WHERE "max_minutes" IS NULL;--> statement-breakpoint
ALTER TABLE "voice_sessions" ALTER COLUMN "max_minutes" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_max_minutes_check" CHECK ("voice_sessions"."max_minutes" between 1 and 1440);
