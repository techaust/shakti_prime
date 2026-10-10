ALTER TABLE "agent_actions" DROP CONSTRAINT "agent_actions_autonomy_check";--> statement-breakpoint
ALTER TABLE "agent_actions" DROP CONSTRAINT "agent_actions_state_check";--> statement-breakpoint
ALTER TABLE "agent_configs" DROP CONSTRAINT "agent_configs_autonomy_check";--> statement-breakpoint
ALTER TABLE "agent_runs" DROP CONSTRAINT "agent_runs_outcome_check";--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "filter_reason" text;--> statement-breakpoint
CREATE INDEX "agent_actions_shadow_idx" ON "agent_actions" USING btree ("entity_id","agent","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "agent_actions"."state" = 'shadowed';--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_shadow_check" CHECK (("agent_actions"."state" <> 'shadowed') = ("agent_actions"."autonomy" <> 'shadow'));--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_autonomy_check" CHECK ("agent_actions"."autonomy" in ('shadow', 'suggest', 'needs_approval', 'automatic'));--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_state_check" CHECK ("agent_actions"."state" in ('proposed', 'shadowed', 'executed', 'approved', 'rejected', 'dismissed'));--> statement-breakpoint
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_autonomy_check" CHECK ("agent_configs"."autonomy" in ('shadow', 'suggest', 'needs_approval', 'automatic'));--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_filter_reason_check" CHECK ("agent_runs"."filter_reason" in ('unreadable_answer', 'unknown_pipeline', 'score_out_of_bounds', 'unknown_candidate', 'unknown_person', 'text_has_phone', 'text_has_identity_number', 'text_has_instruction'));--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_filtered_check" CHECK (("agent_runs"."outcome" <> 'filtered') = ("agent_runs"."filter_reason" is null));--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_outcome_check" CHECK ("agent_runs"."outcome" in ('proposed', 'shadowed', 'acted', 'nothing_to_do', 'filtered', 'switched_off', 'cap_reached', 'unavailable', 'failed'));