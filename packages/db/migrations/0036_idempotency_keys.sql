CREATE TABLE "idempotency_keys" (
	"principal_id" uuid NOT NULL,
	"key" text NOT NULL,
	"command" text NOT NULL,
	"input_hash" text NOT NULL,
	"response_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '7 days' NOT NULL,
	CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY("principal_id","key"),
	CONSTRAINT "idempotency_keys_key_length_check" CHECK (char_length("idempotency_keys"."key") between 1 and 64),
	CONSTRAINT "idempotency_keys_input_hash_check" CHECK ("idempotency_keys"."input_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_idx" ON "idempotency_keys" USING btree ("expires_at");