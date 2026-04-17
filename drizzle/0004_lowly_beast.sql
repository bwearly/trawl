CREATE TABLE "politician_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"politician_id" integer NOT NULL,
	"total_disclosures" integer DEFAULT 0 NOT NULL,
	"purchase_count" integer DEFAULT 0 NOT NULL,
	"sale_count" integer DEFAULT 0 NOT NULL,
	"avg_return_7d" numeric(8, 2),
	"avg_return_30d" numeric(8, 2),
	"avg_return_90d" numeric(8, 2),
	"avg_alpha_7d" numeric(8, 2),
	"avg_alpha_30d" numeric(8, 2),
	"avg_alpha_90d" numeric(8, 2),
	"win_rate_7d" numeric(5, 2),
	"win_rate_30d" numeric(5, 2),
	"win_rate_90d" numeric(5, 2),
	"avg_filing_lag_days" numeric(8, 2),
	"last_trade_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "politician_stats" ADD CONSTRAINT "politician_stats_politician_id_politicians_id_fk" FOREIGN KEY ("politician_id") REFERENCES "public"."politicians"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "politician_stats_politician_id_idx" ON "politician_stats" USING btree ("politician_id");