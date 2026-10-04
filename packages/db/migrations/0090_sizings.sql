ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_id_entity_unique" UNIQUE("id","entity_id");--> statement-breakpoint
CREATE TABLE "sizings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"site_id" uuid,
	"kind" text NOT NULL,
	"item_id" uuid,
	"inputs_json" jsonb NOT NULL,
	"result_json" jsonb NOT NULL,
	"in_bounds" boolean NOT NULL,
	"reasons_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"engine_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "sizings_kind_check" CHECK ("sizings"."kind" in ('pump', 'rooftop')),
	CONSTRAINT "sizings_item_kind_check" CHECK ("sizings"."item_id" is null or "sizings"."kind" = 'pump'),
	CONSTRAINT "sizings_reasons_check" CHECK (jsonb_typeof("sizings"."reasons_json") = 'array' and "sizings"."in_bounds" = (jsonb_array_length("sizings"."reasons_json") = 0)),
	CONSTRAINT "sizings_engine_version_check" CHECK (length("sizings"."engine_version") between 1 and 20)
);
--> statement-breakpoint
ALTER TABLE "sizings" ADD CONSTRAINT "sizings_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sizings" ADD CONSTRAINT "sizings_site_id_customer_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."customer_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sizings" ADD CONSTRAINT "sizings_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sizings" ADD CONSTRAINT "sizings_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sizings" ADD CONSTRAINT "sizings_opportunity_entity_fk" FOREIGN KEY ("opportunity_id","entity_id") REFERENCES "public"."opportunities"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sizings_opportunity_kind_latest_idx" ON "sizings" USING btree ("opportunity_id","kind","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
