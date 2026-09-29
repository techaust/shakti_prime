ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actor_kind_check";--> statement-breakpoint
ALTER TABLE "principals" DROP CONSTRAINT "principals_kind_check";--> statement-breakpoint
ALTER TABLE "roles" DROP CONSTRAINT "roles_key_check";--> statement-breakpoint
-- Unqualified columns: the check is copied to every partition, which a column named by its
-- table's name would not resolve on.
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_kind_check" CHECK ("actor_kind" is null or "actor_kind" in ('user', 'agent', 'voice_session', 'system'));--> statement-breakpoint
ALTER TABLE "principals" ADD CONSTRAINT "principals_kind_check" CHECK ("principals"."kind" in ('user', 'agent', 'voice_session', 'system'));--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_key_check" CHECK ("roles"."key" in ('executive', 'general_manager', 'sales_team_lead', 'tele_caller_cc', 'tele_caller_lc', 'store_manager', 'inventory_manager', 'project_manager', 'field_engineer', 'accounts', 'hr_admin', 'agent:triage', 'agent:concierge', 'agent:copilot', 'agent:sizing', 'agent:orchestrator', 'agent:chief', 'system:workers'));