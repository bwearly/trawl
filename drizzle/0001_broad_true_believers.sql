CREATE TABLE "disclosures" (
	"id" serial PRIMARY KEY NOT NULL,
	"politician_id" integer NOT NULL,
	"ticker" text,
	"asset_name" text NOT NULL,
	"asset_type" text DEFAULT 'stock' NOT NULL,
	"trade_type" text NOT NULL,
	"owner_type" text NOT NULL,
	"amount_min" integer,
	"amount_max" integer,
	"amount_range_label" text,
	"trade_date" timestamp,
	"filing_date" timestamp,
	"filing_lag_days" integer,
	"source_url" text,
	"source_label" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"disclosure_id" integer NOT NULL,
	"politician_id" integer NOT NULL,
	"ticker" text NOT NULL,
	"signal_date" timestamp DEFAULT now() NOT NULL,
	"score" numeric(5, 2) NOT NULL,
	"signal_status" text DEFAULT 'active' NOT NULL,
	"primary_reason" text,
	"reason_summary" text,
	"trade_type_score" numeric(5, 2),
	"trade_size_score" numeric(5, 2),
	"filing_freshness_score" numeric(5, 2),
	"historical_politician_score" numeric(5, 2),
	"momentum_score" numeric(5, 2),
	"committee_relevance_score" numeric(5, 2),
	"cluster_score" numeric(5, 2),
	"user_relevance_score" numeric(5, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "disclosures" ADD CONSTRAINT "disclosures_politician_id_politicians_id_fk" FOREIGN KEY ("politician_id") REFERENCES "public"."politicians"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_signals" ADD CONSTRAINT "research_signals_disclosure_id_disclosures_id_fk" FOREIGN KEY ("disclosure_id") REFERENCES "public"."disclosures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_signals" ADD CONSTRAINT "research_signals_politician_id_politicians_id_fk" FOREIGN KEY ("politician_id") REFERENCES "public"."politicians"("id") ON DELETE no action ON UPDATE no action;