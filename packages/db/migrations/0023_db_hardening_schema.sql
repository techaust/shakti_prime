DROP INDEX "user_two_factor_user_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "user_two_factor_user_unique" ON "user_two_factor" USING btree ("user_id");