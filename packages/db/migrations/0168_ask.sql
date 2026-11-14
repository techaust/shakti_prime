CREATE TABLE "ask_conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_id" smallint,
	"entity_ids" smallint[] NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ask_conversations_owner_unique" UNIQUE("id","user_id","entity_ids"),
	CONSTRAINT "ask_conversations_companies_check" CHECK (cardinality("ask_conversations"."entity_ids") between 1 and 32
      and array_position("ask_conversations"."entity_ids", null) is null
      and case when "ask_conversations"."entity_id" is null then cardinality("ask_conversations"."entity_ids") > 1
               else "ask_conversations"."entity_ids" = array["ask_conversations"."entity_id"] end),
	CONSTRAINT "ask_conversations_title_check" CHECK (char_length("ask_conversations"."title") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "ask_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_id" smallint,
	"entity_ids" smallint[] NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"outcome" text NOT NULL,
	"unsourced" integer DEFAULT 0 NOT NULL,
	"cited_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"returned_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"cost_paise" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ask_messages_companies_check" CHECK (cardinality("ask_messages"."entity_ids") between 1 and 32
      and array_position("ask_messages"."entity_ids", null) is null
      and case when "ask_messages"."entity_id" is null then cardinality("ask_messages"."entity_ids") > 1
               else "ask_messages"."entity_ids" = array["ask_messages"."entity_id"] end),
	CONSTRAINT "ask_messages_question_check" CHECK (char_length("ask_messages"."question") between 1 and 2000),
	CONSTRAINT "ask_messages_answer_check" CHECK (char_length("ask_messages"."answer") <= 8000),
	CONSTRAINT "ask_messages_outcome_check" CHECK ("ask_messages"."outcome" in ('answered', 'unsourced', 'no_answer')),
	CONSTRAINT "ask_messages_unsourced_check" CHECK ("ask_messages"."unsourced" between 0 and 1000),
	CONSTRAINT "ask_messages_cited_check" CHECK (jsonb_typeof("ask_messages"."cited_json") = 'array' and jsonb_array_length("ask_messages"."cited_json") <= 50),
	CONSTRAINT "ask_messages_returned_check" CHECK (jsonb_typeof("ask_messages"."returned_json") = 'array' and jsonb_array_length("ask_messages"."returned_json") <= 500),
	CONSTRAINT "ask_messages_model_check" CHECK (char_length("ask_messages"."model") <= 60),
	CONSTRAINT "ask_messages_cost_check" CHECK ("ask_messages"."cost_paise" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ask_conversations" ADD CONSTRAINT "ask_conversations_user_id_principals_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_conversations" ADD CONSTRAINT "ask_conversations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_messages" ADD CONSTRAINT "ask_messages_user_id_principals_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_messages" ADD CONSTRAINT "ask_messages_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_messages" ADD CONSTRAINT "ask_messages_conversation_fk" FOREIGN KEY ("conversation_id","user_id","entity_ids") REFERENCES "public"."ask_conversations"("id","user_id","entity_ids") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ask_conversations_user_updated_idx" ON "ask_conversations" USING btree ("user_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ask_conversations_updated_idx" ON "ask_conversations" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "ask_messages_conversation_idx" ON "ask_messages" USING btree ("conversation_id","created_at","id");--> statement-breakpoint
CREATE INDEX "ask_messages_created_idx" ON "ask_messages" USING btree ("created_at");