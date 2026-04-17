CREATE TABLE "alert_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"min_score" numeric(5, 2) DEFAULT '0' NOT NULL,
	"enable_watched_ticker_alerts" boolean DEFAULT true NOT NULL,
	"enable_watched_politician_alerts" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "alert_preferences_user_id_idx" ON "alert_preferences" USING btree ("user_id");