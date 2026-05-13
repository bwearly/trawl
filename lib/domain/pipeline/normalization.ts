export function normalizeYahooSymbol(symbol: string) {
  const trimmed = symbol.trim().toUpperCase();

  if (trimmed === "APPL") return "AAPL";
  if (trimmed === "BRKB") return "BRK-B";
  if (trimmed === "BRK.B" || trimmed === "BRK-B") return "BRK-B";
  if (trimmed === "BF.B" || trimmed === "BF-B") return "BF-B";

  return trimmed;
}

export function normalizeTickerForStorage(symbol: string) {
  const trimmed = symbol.trim().toUpperCase();

  if (trimmed === "APPL") return "AAPL";
  if (trimmed === "BRKB") return "BRK.B";
  if (trimmed === "BRK-B") return "BRK.B";
  if (trimmed === "BF-B") return "BF.B";

  return trimmed;
}

export function normalizeTradeType(raw: string | null): "purchase" | "sale" | "exchange" {
  const value = (raw ?? "").trim().toUpperCase();
  if (value === "P" || value.includes("PURCHASE") || value.includes("BUY")) {
    return "purchase";
  }
  if (value === "S" || value.includes("SALE") || value.includes("SELL")) {
    return "sale";
  }
  return "exchange";
}
