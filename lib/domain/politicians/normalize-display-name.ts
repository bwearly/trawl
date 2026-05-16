export function normalizePoliticianDisplayName(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return "";

  return value
    .replace(/^(?:\s*hon\.?\s+)+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}
