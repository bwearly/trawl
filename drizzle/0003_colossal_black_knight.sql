CREATE TABLE "price_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"date" timestamp NOT NULL,
	"open" numeric(12, 2),
	"high" numeric(12, 2),
	"low" numeric(12, 2),
	"close" numeric(12, 2),
	"adjusted_close" numeric(12, 2),
	"volume" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
