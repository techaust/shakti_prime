CREATE TABLE "voice_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_id" smallint,
	"entity_ids" smallint[] NOT NULL,
	"mode" text NOT NULL,
	"consent_recording" boolean NOT NULL,
	"audio_file_id" uuid,
	"transcript_file_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"minutes" integer,
	"cost_paise" integer DEFAULT 0 NOT NULL,
	"turn_stats_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_sessions_companies_check" CHECK (cardinality("voice_sessions"."entity_ids") between 1 and 32
      and array_position("voice_sessions"."entity_ids", null) is null
      and case when "voice_sessions"."entity_id" is null then cardinality("voice_sessions"."entity_ids") > 1
               else cardinality("voice_sessions"."entity_ids") = 1 and "voice_sessions"."entity_ids"[1] = "voice_sessions"."entity_id" end),
	CONSTRAINT "voice_sessions_mode_check" CHECK ("voice_sessions"."mode" in ('teach', 'ask')),
	CONSTRAINT "voice_sessions_ended_check" CHECK ("voice_sessions"."ended_at" is null or "voice_sessions"."ended_at" >= "voice_sessions"."started_at"),
	CONSTRAINT "voice_sessions_minutes_check" CHECK ("voice_sessions"."minutes" is null or ("voice_sessions"."minutes" between 0 and 1440 and "voice_sessions"."ended_at" is not null)),
	CONSTRAINT "voice_sessions_cost_check" CHECK ("voice_sessions"."cost_paise" >= 0),
	CONSTRAINT "voice_sessions_turn_stats_check" CHECK (jsonb_typeof("voice_sessions"."turn_stats_json") = 'object'),
	CONSTRAINT "voice_sessions_recording_check" CHECK ("voice_sessions"."consent_recording" or ("voice_sessions"."audio_file_id" is null and "voice_sessions"."transcript_file_id" is null))
);
--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_id_principals_id_fk" FOREIGN KEY ("id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_user_id_principals_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_audio_file_id_files_id_fk" FOREIGN KEY ("audio_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_transcript_file_id_files_id_fk" FOREIGN KEY ("transcript_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_sessions_user_started_idx" ON "voice_sessions" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "voice_sessions_started_idx" ON "voice_sessions" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "voice_sessions_audio_file_idx" ON "voice_sessions" USING btree ("audio_file_id") WHERE "voice_sessions"."audio_file_id" is not null;--> statement-breakpoint
CREATE INDEX "voice_sessions_transcript_file_idx" ON "voice_sessions" USING btree ("transcript_file_id") WHERE "voice_sessions"."transcript_file_id" is not null;