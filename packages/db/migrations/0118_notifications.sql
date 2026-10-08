CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text,
	"in_app" boolean DEFAULT true NOT NULL,
	"push" boolean DEFAULT true NOT NULL,
	"quiet_from" time,
	"quiet_to" time,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_type_unique" UNIQUE NULLS NOT DISTINCT("user_id","type"),
	CONSTRAINT "notification_preferences_type_check" CHECK ("notification_preferences"."type" is null or "notification_preferences"."type" in ('lead_assigned', 'duplicate_found', 'call_due', 'quote_expiring', 'first_call_late', 'enquiry_routed', 'order_credit_held')),
	CONSTRAINT "notification_preferences_quiet_check" CHECK (("notification_preferences"."quiet_from" is null) = ("notification_preferences"."quiet_to" is null)
        and ("notification_preferences"."quiet_from" is null or "notification_preferences"."quiet_from" <> "notification_preferences"."quiet_to")
        and ("notification_preferences"."type" is null or "notification_preferences"."quiet_from" is null))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_id" smallint NOT NULL,
	"type" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"channel_sent_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "notifications_user_dedupe_unique" UNIQUE("user_id","dedupe_key"),
	CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('lead_assigned', 'duplicate_found', 'call_due', 'quote_expiring', 'first_call_late', 'enquiry_routed', 'order_credit_held')),
	CONSTRAINT "notifications_subject_type_check" CHECK ("notifications"."subject_type" in ('opportunity', 'duplicate_candidate', 'task', 'quote', 'inbox_item', 'sales_order')),
	CONSTRAINT "notifications_payload_check" CHECK (jsonb_typeof("notifications"."payload_json") = 'object'),
	CONSTRAINT "notifications_channels_check" CHECK (jsonb_typeof("notifications"."channel_sent_json") = 'object'),
	CONSTRAINT "notifications_dedupe_key_check" CHECK (char_length("notifications"."dedupe_key") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_ok_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint"),
	CONSTRAINT "push_subscriptions_endpoint_check" CHECK ("push_subscriptions"."endpoint" like 'https://%' and char_length("push_subscriptions"."endpoint") <= 1000),
	CONSTRAINT "push_subscriptions_keys_check" CHECK (char_length("push_subscriptions"."p256dh") between 80 and 100 and char_length("push_subscriptions"."auth") between 16 and 32),
	CONSTRAINT "push_subscriptions_user_agent_check" CHECK (char_length("push_subscriptions"."user_agent") <= 300)
);
--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "segment" text;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_principals_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_principals_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_principals_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id","entity_id") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_entity_dedupe_idx" ON "notifications" USING btree ("entity_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "opportunities_open_created_idx" ON "opportunities" USING btree ("entity_id","created_at") WHERE "opportunities"."state" = 'open' and "opportunities"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "tasks_open_calls_due_idx" ON "tasks" USING btree ("entity_id","due_at") WHERE "tasks"."state" = 'open' and "tasks"."kind" in ('callback', 'nurture');--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_segment_check" CHECK ("inbox_items"."segment" in ('farmer_pumps', 'residential_rooftop', 'commercial_epc', 'dealer_wholesale'));--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_note_check" CHECK (char_length("inbox_items"."note") between 1 and 500);--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_routed_check" CHECK ("inbox_items"."kind" <> 'agent_suggestion' or ("inbox_items"."segment" is null and "inbox_items"."note" is null));