CREATE TABLE IF NOT EXISTS "payment_order" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "client_request_id" text NOT NULL,
  "provider" text NOT NULL,
  "purpose" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "currency" text NOT NULL,
  "amount" numeric(18, 3) NOT NULL,
  "amount_minor" bigint NOT NULL,
  "credits_amount" numeric(18, 2) NOT NULL,
  "pricing_snapshot" json NOT NULL,
  "provider_payload" json,
  "provider_trade_no" text,
  "expires_at" timestamp,
  "fulfilled_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_order_user_client_request_unique" ON "payment_order" USING btree ("user_id", "client_request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_order_provider_trade_no_unique" ON "payment_order" USING btree ("provider", "provider_trade_no") WHERE "payment_order"."provider_trade_no" is not null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_order_user_id_created_at_idx" ON "payment_order" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_order_status_idx" ON "payment_order" USING btree ("status");
