CREATE TABLE "disclosure_performance_windows" (
	"id" serial PRIMARY KEY NOT NULL,
	"disclosure_id" integer NOT NULL,
	"ticker" text NOT NULL,
	"trade_date_price" numeric(12, 2),
	"filing_date_price" numeric(12, 2),
	"return_7d" numeric(8, 2),
	"return_30d" numeric(8, 2),
	"return_90d" numeric(8, 2),
	"spy_return_7d" numeric(8, 2),
	"spy_return_30d" numeric(8, 2),
	"spy_return_90d" numeric(8, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "disclosure_performance_windows" ADD CONSTRAINT "disclosure_performance_windows_disclosure_id_disclosures_id_fk" FOREIGN KEY ("disclosure_id") REFERENCES "public"."disclosures"("id") ON DELETE no action ON UPDATE no action;