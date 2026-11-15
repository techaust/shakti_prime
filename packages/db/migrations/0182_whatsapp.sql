-- W1 WhatsApp threads and messaging (docs/03-roadmap-appendix/phase2.md §6.1). `whatsapp_messages` is
-- partitioned by month (docs/05-database.md §7); drizzle-kit cannot emit the PARTITION BY clause, so it
-- was added to the generated statement before the file was applied.
CREATE TABLE "whatsapp_message_keys" (
	"provider_message_id" text PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"message_id" uuid NOT NULL,
	"message_created_at" timestamp with time zone NOT NULL,
	"thread_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_message_keys_id_check" CHECK (char_length("whatsapp_message_keys"."provider_message_id") between 1 and 256)
);
--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" uuid NOT NULL,
	"entity_id" smallint NOT NULL,
	"thread_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"provider_message_id" text,
	"template_name" text,
	"template_params" jsonb,
	"body_masked" text,
	"button_payload" text,
	"file_id" uuid,
	"status" text,
	"status_at" timestamp with time zone,
	"refusal" text,
	"error_code" integer,
	"sent_by" uuid,
	"drafted_by_agent_action_id" uuid,
	"send_attempted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY("id","created_at"),
	CONSTRAINT "whatsapp_messages_direction_check" CHECK ("whatsapp_messages"."direction" in ('inbound', 'outbound')),
	CONSTRAINT "whatsapp_messages_kind_check" CHECK ("whatsapp_messages"."kind" in ('text', 'template', 'media', 'button', 'system')),
	CONSTRAINT "whatsapp_messages_status_check" CHECK ("whatsapp_messages"."status" is null or "whatsapp_messages"."status" in ('queued', 'sent', 'delivered', 'read', 'failed', 'refused')),
	CONSTRAINT "whatsapp_messages_refusal_check" CHECK ("whatsapp_messages"."refusal" is null or "whatsapp_messages"."refusal" in ('opted_out', 'window_closed', 'template_not_approved', 'tier_budget_reached', 'output_filter')),
	CONSTRAINT "whatsapp_messages_direction_shape_check" CHECK (case when "whatsapp_messages"."direction" = 'inbound'
               then "whatsapp_messages"."provider_message_id" is not null and "whatsapp_messages"."status" is null and "whatsapp_messages"."sent_by" is null
                    and "whatsapp_messages"."send_attempted_at" is null
               else "whatsapp_messages"."status" is not null and "whatsapp_messages"."sent_by" is not null end),
	CONSTRAINT "whatsapp_messages_refused_check" CHECK (("whatsapp_messages"."status" = 'refused') = ("whatsapp_messages"."refusal" is not null)),
	CONSTRAINT "whatsapp_messages_template_check" CHECK (("whatsapp_messages"."kind" in ('template', 'system')) = ("whatsapp_messages"."template_name" is not null)),
	CONSTRAINT "whatsapp_messages_template_name_check" CHECK ("whatsapp_messages"."template_name" is null
          or ("whatsapp_messages"."template_name" ~ '^[a-z0-9_]+$' and char_length("whatsapp_messages"."template_name") <= 512)),
	CONSTRAINT "whatsapp_messages_template_params_check" CHECK ("whatsapp_messages"."template_params" is null
          or (jsonb_typeof("whatsapp_messages"."template_params") = 'array'
              and jsonb_array_length("whatsapp_messages"."template_params") <= 20
              and octet_length("whatsapp_messages"."template_params"::text) <= 8000)),
	CONSTRAINT "whatsapp_messages_body_check" CHECK ("whatsapp_messages"."body_masked" is null or char_length("whatsapp_messages"."body_masked") between 1 and 4096),
	CONSTRAINT "whatsapp_messages_provider_id_check" CHECK ("whatsapp_messages"."provider_message_id" is null or char_length("whatsapp_messages"."provider_message_id") between 1 and 256),
	CONSTRAINT "whatsapp_messages_button_check" CHECK ("whatsapp_messages"."button_payload" is null or char_length("whatsapp_messages"."button_payload") between 1 and 256)

) PARTITION BY RANGE ("created_at");
--> statement-breakpoint
CREATE TABLE "whatsapp_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"name" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_at" timestamp with time zone,
	"params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"buttons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"purpose" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "whatsapp_templates_entity_name_unique" UNIQUE("entity_id","name","language"),
	CONSTRAINT "whatsapp_templates_name_check" CHECK ("whatsapp_templates"."name" ~ '^[a-z0-9_]+$' and char_length("whatsapp_templates"."name") <= 512),
	CONSTRAINT "whatsapp_templates_language_check" CHECK ("whatsapp_templates"."language" in ('en')),
	CONSTRAINT "whatsapp_templates_category_check" CHECK ("whatsapp_templates"."category" in ('utility', 'marketing', 'authentication')),
	CONSTRAINT "whatsapp_templates_status_check" CHECK ("whatsapp_templates"."status" in ('pending', 'approved', 'rejected', 'paused', 'disabled')),
	CONSTRAINT "whatsapp_templates_purpose_check" CHECK ("whatsapp_templates"."purpose" is null or "whatsapp_templates"."purpose" in ('welcome', 'opt_out_confirmation')),
	CONSTRAINT "whatsapp_templates_params_check" CHECK (jsonb_typeof("whatsapp_templates"."params") = 'array' and jsonb_array_length("whatsapp_templates"."params") <= 20
          and octet_length("whatsapp_templates"."params"::text) <= 4000),
	CONSTRAINT "whatsapp_templates_buttons_check" CHECK (jsonb_typeof("whatsapp_templates"."buttons") = 'array' and jsonb_array_length("whatsapp_templates"."buttons") <= 10
          and octet_length("whatsapp_templates"."buttons"::text) <= 4000)
);
--> statement-breakpoint
CREATE TABLE "whatsapp_threads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"channel_id" uuid NOT NULL,
	"wa_id" text NOT NULL,
	"account_id" uuid,
	"contact_phone_id" uuid,
	"opportunity_id" uuid,
	"assignee_id" uuid,
	"window_open_until" timestamp with time zone,
	"opted_out_at" timestamp with time zone,
	"handled_by" text DEFAULT 'assistant' NOT NULL,
	"handoff_reason" text,
	"handed_off_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"needs_reply" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "whatsapp_threads_channel_wa_unique" UNIQUE("channel_id","wa_id"),
	CONSTRAINT "whatsapp_threads_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "whatsapp_threads_wa_id_check" CHECK ("whatsapp_threads"."wa_id" ~ '^[1-9][0-9]{6,14}$'),
	CONSTRAINT "whatsapp_threads_handled_by_check" CHECK ("whatsapp_threads"."handled_by" in ('assistant', 'people')),
	CONSTRAINT "whatsapp_threads_handoff_reason_check" CHECK ("whatsapp_threads"."handoff_reason" is null or "whatsapp_threads"."handoff_reason" in ('keyword', 'request', 'filter_refusals', 'complaint')),
	CONSTRAINT "whatsapp_threads_handoff_check" CHECK (("whatsapp_threads"."handled_by" = 'people') = ("whatsapp_threads"."handoff_reason" is not null)
          and ("whatsapp_threads"."handled_by" = 'people') = ("whatsapp_threads"."handed_off_at" is not null)),
	CONSTRAINT "whatsapp_threads_customer_check" CHECK (("whatsapp_threads"."contact_phone_id" is null or "whatsapp_threads"."account_id" is not null)
          and ("whatsapp_threads"."opportunity_id" is null or "whatsapp_threads"."account_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "whatsapp_message_keys" ADD CONSTRAINT "whatsapp_message_keys_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_message_keys" ADD CONSTRAINT "whatsapp_message_keys_message_fk" FOREIGN KEY ("message_id","message_created_at") REFERENCES "public"."whatsapp_messages"("id","created_at") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_message_keys" ADD CONSTRAINT "whatsapp_message_keys_thread_fk" FOREIGN KEY ("thread_id","entity_id") REFERENCES "public"."whatsapp_threads"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_sent_by_principals_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_thread_fk" FOREIGN KEY ("thread_id","entity_id") REFERENCES "public"."whatsapp_threads"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_file_fk" FOREIGN KEY ("file_id","entity_id") REFERENCES "public"."files"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_threads" ADD CONSTRAINT "whatsapp_threads_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_threads" ADD CONSTRAINT "whatsapp_threads_channel_id_entity_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."entity_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_threads" ADD CONSTRAINT "whatsapp_threads_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_threads" ADD CONSTRAINT "whatsapp_threads_contact_phone_id_contact_phones_id_fk" FOREIGN KEY ("contact_phone_id") REFERENCES "public"."contact_phones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_threads" ADD CONSTRAINT "whatsapp_threads_assignee_id_principals_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_threads" ADD CONSTRAINT "whatsapp_threads_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_threads" ADD CONSTRAINT "whatsapp_threads_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_threads" ADD CONSTRAINT "whatsapp_threads_opportunity_fk" FOREIGN KEY ("opportunity_id","entity_id","account_id") REFERENCES "public"."opportunities"("id","entity_id","account_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "whatsapp_message_keys_message_idx" ON "whatsapp_message_keys" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "whatsapp_message_keys_thread_idx" ON "whatsapp_message_keys" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "whatsapp_messages_thread_created_idx" ON "whatsapp_messages" USING btree ("thread_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "whatsapp_messages_queued_idx" ON "whatsapp_messages" USING btree ("entity_id","created_at") WHERE "whatsapp_messages"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "whatsapp_messages_file_idx" ON "whatsapp_messages" USING btree ("file_id") WHERE "whatsapp_messages"."file_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_templates_purpose_unique" ON "whatsapp_templates" USING btree ("entity_id","purpose") WHERE "whatsapp_templates"."purpose" is not null;--> statement-breakpoint
CREATE INDEX "whatsapp_threads_account_idx" ON "whatsapp_threads" USING btree ("account_id","entity_id");--> statement-breakpoint
CREATE INDEX "whatsapp_threads_opportunity_idx" ON "whatsapp_threads" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "whatsapp_threads_waiting_idx" ON "whatsapp_threads" USING btree ("entity_id","last_inbound_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "whatsapp_threads"."needs_reply";--> statement-breakpoint
CREATE INDEX "whatsapp_threads_assignee_idx" ON "whatsapp_threads" USING btree ("assignee_id","last_inbound_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "whatsapp_threads"."needs_reply";--> statement-breakpoint
CREATE INDEX "whatsapp_threads_contact_phone_idx" ON "whatsapp_threads" USING btree ("contact_phone_id");