CREATE TABLE "watchlist_digest_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"research_signal_id" integer NOT NULL,
	"delivery_type" text DEFAULT 'daily_digest' NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"sent_at" timestamp,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_jobs" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "notification_jobs" ADD COLUMN "text_body" text;--> statement-breakpoint
ALTER TABLE "notification_jobs" ADD COLUMN "html_body" text;--> statement-breakpoint
ALTER TABLE "watchlist_digest_deliveries" ADD CONSTRAINT "watchlist_digest_deliveries_research_signal_id_research_signals_id_fk" FOREIGN KEY ("research_signal_id") REFERENCES "public"."research_signals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "watchlist_digest_deliveries_user_id_idx" ON "watchlist_digest_deliveries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "watchlist_digest_deliveries_signal_idx" ON "watchlist_digest_deliveries" USING btree ("research_signal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_digest_deliveries_unique_idx" ON "watchlist_digest_deliveries" USING btree ("user_id","research_signal_id","delivery_type");