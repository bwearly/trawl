CREATE TABLE "watchlist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"watchlist_id" integer NOT NULL,
	"item_type" text NOT NULL,
	"politician_id" integer,
	"ticker" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlists" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text DEFAULT 'My Watchlist' NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_watchlist_id_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_politician_id_politicians_id_fk" FOREIGN KEY ("politician_id") REFERENCES "public"."politicians"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "watchlist_items_watchlist_id_idx" ON "watchlist_items" USING btree ("watchlist_id");--> statement-breakpoint
CREATE INDEX "watchlist_items_politician_id_idx" ON "watchlist_items" USING btree ("politician_id");--> statement-breakpoint
CREATE INDEX "watchlist_items_ticker_idx" ON "watchlist_items" USING btree ("ticker");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_items_unique_politician_per_watchlist_idx" ON "watchlist_items" USING btree ("watchlist_id","item_type","politician_id");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_items_unique_ticker_per_watchlist_idx" ON "watchlist_items" USING btree ("watchlist_id","item_type","ticker");--> statement-breakpoint
CREATE INDEX "watchlists_user_id_idx" ON "watchlists" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "watchlists_user_default_idx" ON "watchlists" USING btree ("user_id","is_default");