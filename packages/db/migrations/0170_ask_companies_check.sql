-- The companies check, written without an array literal (B1): the same rule as 0168's, so every
-- row already meets it and it is added NOT VALID, with no scan.
ALTER TABLE "ask_conversations" DROP CONSTRAINT "ask_conversations_companies_check";--> statement-breakpoint
ALTER TABLE "ask_messages" DROP CONSTRAINT "ask_messages_companies_check";--> statement-breakpoint
ALTER TABLE "ask_conversations" ADD CONSTRAINT "ask_conversations_companies_check" CHECK (cardinality("ask_conversations"."entity_ids") between 1 and 32
      and array_position("ask_conversations"."entity_ids", null) is null
      and case when "ask_conversations"."entity_id" is null then cardinality("ask_conversations"."entity_ids") > 1
               else cardinality("ask_conversations"."entity_ids") = 1 and "ask_conversations"."entity_ids"[1] = "ask_conversations"."entity_id" end) NOT VALID;--> statement-breakpoint
ALTER TABLE "ask_messages" ADD CONSTRAINT "ask_messages_companies_check" CHECK (cardinality("ask_messages"."entity_ids") between 1 and 32
      and array_position("ask_messages"."entity_ids", null) is null
      and case when "ask_messages"."entity_id" is null then cardinality("ask_messages"."entity_ids") > 1
               else cardinality("ask_messages"."entity_ids") = 1 and "ask_messages"."entity_ids"[1] = "ask_messages"."entity_id" end) NOT VALID;