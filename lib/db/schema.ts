import {
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const politicians = pgTable("politicians", {
  id: serial("id").primaryKey(),
  fullName: text("full_name").notNull(),
  chamber: text("chamber").notNull(), // house | senate
  party: text("party"),
  state: text("state"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const disclosures = pgTable("disclosures", {
  id: serial("id").primaryKey(),

  politicianId: integer("politician_id")
    .notNull()
    .references(() => politicians.id),

  ticker: text("ticker"),
  assetName: text("asset_name").notNull(),
  assetType: text("asset_type").default("stock").notNull(), // stock | etf | option | other

  tradeType: text("trade_type").notNull(), // purchase | sale | exchange
  ownerType: text("owner_type").notNull(), // self | spouse | dependent | joint | unknown

  amountMin: integer("amount_min"),
  amountMax: integer("amount_max"),
  amountRangeLabel: text("amount_range_label"),

  tradeDate: timestamp("trade_date"),
  filingDate: timestamp("filing_date"),
  filingLagDays: integer("filing_lag_days"),

  sourceUrl: text("source_url"),
  sourceLabel: text("source_label"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const researchSignals = pgTable("research_signals", {
  id: serial("id").primaryKey(),

  disclosureId: integer("disclosure_id")
    .notNull()
    .references(() => disclosures.id),

  politicianId: integer("politician_id")
    .notNull()
    .references(() => politicians.id),

  ticker: text("ticker").notNull(),
  signalDate: timestamp("signal_date").defaultNow().notNull(),

  score: numeric("score", { precision: 5, scale: 2 }).notNull(), // 0.00 - 100.00
  signalStatus: text("signal_status").default("active").notNull(), // active | archived | suppressed

  primaryReason: text("primary_reason"),
  reasonSummary: text("reason_summary"),

  tradeTypeScore: numeric("trade_type_score", { precision: 5, scale: 2 }),
  tradeSizeScore: numeric("trade_size_score", { precision: 5, scale: 2 }),
  filingFreshnessScore: numeric("filing_freshness_score", {
    precision: 5,
    scale: 2,
  }),
  historicalPoliticianScore: numeric("historical_politician_score", {
    precision: 5,
    scale: 2,
  }),
  momentumScore: numeric("momentum_score", { precision: 5, scale: 2 }),
  committeeRelevanceScore: numeric("committee_relevance_score", {
    precision: 5,
    scale: 2,
  }),
  clusterScore: numeric("cluster_score", { precision: 5, scale: 2 }),
  userRelevanceScore: numeric("user_relevance_score", {
    precision: 5,
    scale: 2,
  }),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});