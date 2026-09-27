DROP INDEX "opportunities_entity_owner_idx";--> statement-breakpoint
DROP INDEX "opportunities_entity_team_idx";--> statement-breakpoint
CREATE INDEX "opportunities_entity_owner_idx" ON "opportunities" USING btree ("entity_id","owner_id","updated_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "opportunities_entity_team_idx" ON "opportunities" USING btree ("entity_id","team_id","updated_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);