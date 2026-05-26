import type { UserDigestBatch } from "@/lib/domain/watchlists/daily-digest";

export function renderWatchlistDigestEmail(batch: UserDigestBatch) {
  const subject = `TRAWL watchlist digest: ${batch.signals.length} new signal(s)`;
  const lines = [
    `You have ${batch.signals.length} new watchlist signal(s) worth reviewing.`,
    "",
  ];
  for (const s of batch.signals) {
    lines.push(`- ${s.ticker} | ${s.politicianName} | ${s.tradeType} | score ${s.score.toFixed(2)} | filing lag ${s.filingLagDays ?? "n/a"}d`);
    if (s.amountRangeLabel) lines.push(`  Amount: ${s.amountRangeLabel}`);
    if (s.primaryReason) lines.push(`  Reason: ${s.primaryReason}`);
    if (s.reasonSummary) lines.push(`  Summary: ${s.reasonSummary}`);
    lines.push(`  Link: ${s.signalUrl}`);
  }
  lines.push("", "TRAWL is for research and informational purposes only and is not financial advice.");

  const text = lines.join("\n");
  const html = `<p>You have <strong>${batch.signals.length}</strong> new watchlist signal(s) worth reviewing.</p><ul>${batch.signals
    .map(
      (s) =>
        `<li><strong>${s.ticker}</strong> · ${s.politicianName} · ${s.tradeType} · score ${s.score.toFixed(
          2
        )} · filing lag ${s.filingLagDays ?? "n/a"}d<br/>${
          s.amountRangeLabel ? `Amount: ${s.amountRangeLabel}<br/>` : ""
        }${s.primaryReason ? `Reason: ${s.primaryReason}<br/>` : ""}${
          s.reasonSummary ? `Summary: ${s.reasonSummary}<br/>` : ""
        }<a href="${s.signalUrl}">View signal</a></li>`
    )
    .join("")}</ul><p>TRAWL is for research and informational purposes only and is not financial advice.</p>`;

  return { subject, text, html };
}
