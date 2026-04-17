import {
  integer,
  numeric,
  boolean,
  index,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const politicians = pgTable("politicians", {
  id: serial("id").primaryKey(),
  fullName: text("full_name").notNull(),
  chamber: text("chamber").notNull(), // house | senate
  party: text("party"),
  state: text("state"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const politicianStats = pgTable(
  "politician_stats",
  {
    id: serial("id").primaryKey(),

    politicianId: integer("politician_id")
      .notNull()
      .references(() => politicians.id),

    totalDisclosures: integer("total_disclosures").default(0).notNull(),
    purchaseCount: integer("purchase_count").default(0).notNull(),
    saleCount: integer("sale_count").default(0).notNull(),

    avgReturn7d: numeric("avg_return_7d", { precision: 8, scale: 2 }),
    avgReturn30d: numeric("avg_return_30d", { precision: 8, scale: 2 }),
    avgReturn90d: numeric("avg_return_90d", { precision: 8, scale: 2 }),

    avgAlpha7d: numeric("avg_alpha_7d", { precision: 8, scale: 2 }),
    avgAlpha30d: numeric("avg_alpha_30d", { precision: 8, scale: 2 }),
    avgAlpha90d: numeric("avg_alpha_90d", { precision: 8, scale: 2 }),

    winRate7d: numeric("win_rate_7d", { precision: 5, scale: 2 }),
    winRate30d: numeric("win_rate_30d", { precision: 5, scale: 2 }),
    winRate90d: numeric("win_rate_90d", { precision: 5, scale: 2 }),

    avgFilingLagDays: numeric("avg_filing_lag_days", { precision: 8, scale: 2 }),

    lastTradeDate: timestamp("last_trade_date"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    politicianIdUnique: uniqueIndex("politician_stats_politician_id_idx").on(
      table.politicianId
    ),
  })
);

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

export const disclosurePerformanceWindows = pgTable("disclosure_performance_windows", {
  id: serial("id").primaryKey(),

  disclosureId: integer("disclosure_id")
    .notNull()
    .references(() => disclosures.id),

  ticker: text("ticker").notNull(),

  tradeDatePrice: numeric("trade_date_price", { precision: 12, scale: 2 }),
  filingDatePrice: numeric("filing_date_price", { precision: 12, scale: 2 }),

  return7d: numeric("return_7d", { precision: 8, scale: 2 }),
  return30d: numeric("return_30d", { precision: 8, scale: 2 }),
  return90d: numeric("return_90d", { precision: 8, scale: 2 }),

  spyReturn7d: numeric("spy_return_7d", { precision: 8, scale: 2 }),
  spyReturn30d: numeric("spy_return_30d", { precision: 8, scale: 2 }),
  spyReturn90d: numeric("spy_return_90d", { precision: 8, scale: 2 }),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const priceHistory = pgTable("price_history", {
  id: serial("id").primaryKey(),

  ticker: text("ticker").notNull(),
  date: timestamp("date").notNull(),

  open: numeric("open", { precision: 12, scale: 2 }),
  high: numeric("high", { precision: 12, scale: 2 }),
  low: numeric("low", { precision: 12, scale: 2 }),
  close: numeric("close", { precision: 12, scale: 2 }),
  adjustedClose: numeric("adjusted_close", { precision: 12, scale: 2 }),
  volume: numeric("volume", { mode: "number" }),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const watchlists = pgTable(
  "watchlists",
  {
    id: serial("id").primaryKey(),

    userId: text("user_id").notNull(),

    name: text("name").notNull().default("My Watchlist"),
    isDefault: boolean("is_default").notNull().default(true),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("watchlists_user_id_idx").on(table.userId),
    userDefaultIdx: index("watchlists_user_default_idx").on(
      table.userId,
      table.isDefault
    ),
  })
);

export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: serial("id").primaryKey(),

    watchlistId: integer("watchlist_id")
      .notNull()
      .references(() => watchlists.id),

    itemType: text("item_type").notNull(), // politician | ticker
    politicianId: integer("politician_id").references(() => politicians.id),
    ticker: text("ticker"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    watchlistIdIdx: index("watchlist_items_watchlist_id_idx").on(table.watchlistId),
    politicianIdIdx: index("watchlist_items_politician_id_idx").on(table.politicianId),
    tickerIdx: index("watchlist_items_ticker_idx").on(table.ticker),

    uniquePoliticianPerWatchlist: uniqueIndex(
      "watchlist_items_unique_politician_per_watchlist_idx"
    ).on(table.watchlistId, table.itemType, table.politicianId),

    uniqueTickerPerWatchlist: uniqueIndex(
      "watchlist_items_unique_ticker_per_watchlist_idx"
    ).on(table.watchlistId, table.itemType, table.ticker),
  })
);