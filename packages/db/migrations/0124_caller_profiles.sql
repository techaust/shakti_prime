CREATE TABLE "caller_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_id" smallint NOT NULL,
	"is_converter" boolean DEFAULT false NOT NULL,
	"presence" text DEFAULT 'away' NOT NULL,
	"max_open" integer,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"segments" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "caller_profiles_user_entity_unique" UNIQUE("user_id","entity_id"),
	CONSTRAINT "caller_profiles_presence_check" CHECK ("caller_profiles"."presence" in ('present', 'away')),
	CONSTRAINT "caller_profiles_max_open_check" CHECK ("caller_profiles"."max_open" is null or "caller_profiles"."max_open" between 1 and 1000),
	CONSTRAINT "caller_profiles_languages_check" CHECK ("caller_profiles"."languages" <@ array['hinglish', 'en']::text[]),
	CONSTRAINT "caller_profiles_segments_check" CHECK ("caller_profiles"."segments" <@ array['farmer_pumps', 'residential_rooftop', 'commercial_epc', 'dealer_wholesale']::text[])
);
--> statement-breakpoint
ALTER TABLE "caller_profiles" ADD CONSTRAINT "caller_profiles_user_id_principals_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caller_profiles" ADD CONSTRAINT "caller_profiles_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caller_profiles" ADD CONSTRAINT "caller_profiles_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "caller_profiles_converters_idx" ON "caller_profiles" USING btree ("entity_id") WHERE "caller_profiles"."is_converter" and "caller_profiles"."presence" = 'present';