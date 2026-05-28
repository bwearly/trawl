# Senate disclosure import plan

_Last investigated: May 28, 2026._

## Executive summary

Trawl should treat Senate disclosures as a separate importer family first (`senate:*`) and only feed normalized, idempotent PTR rows into the existing disclosure/scoring pipeline after a proof-of-concept validates the source behavior. The recommended source is the official Senate eFD public search system because it is the authoritative public source for Senator, former Senator, and Senate candidate reports from 2012-present, but it is not a simple bulk structured export and it includes explicit use restrictions that must be respected.

## Sources investigated

### Official Senate public disclosure landing page

- URL: <https://www.senate.gov/pagelayout/legislative/g_three_sections_with_teasers/lobbyingdisc.htm>
- Findings:
  - The Senate Office of Public Records receives, processes, and maintains public records filed with the Secretary of the Senate.
  - The page links to the Senate Public Financial Disclosure database at `efdsearch.senate.gov`.
  - The page states that the STOCK Act requires Senators and senior staff to periodically disclose purchases, sales, or exchanges of covered securities over $1,000.
  - The same page exposes compressed XML downloads for gift/travel data, but not for Senate financial disclosure/PTR data.

### Senate eFD public search

- URL: <https://efdsearch.senate.gov/search/home/>
- Findings:
  - The site says it includes financial disclosure reports for Senators, former Senators, and Senate candidates filed from 2012 to present.
  - Public access is gated by an acknowledgement of statutory prohibitions under the Ethics in Government Act.
  - The public search appears to expose report metadata through a search UI and individual report pages such as `/search/view/ptr/{uuid}/`.
  - Publicly referenced examples of printed PTRs show transaction rows with owner, ticker, asset name, asset type, transaction type, amount, comments, filing date, and report URL.
  - There is no clearly advertised official bulk CSV/XML/JSON export for financial disclosure PTRs.

### Senate Ethics financial disclosure guidance

- URL: <https://www.ethics.senate.gov/public/index.cfm/financialdisclosure>
- Findings:
  - The Ethics in Government Act, Senate Rule 34, and Senate Rule 41 require Members, officers, certain employees, and candidates to file public financial disclosure reports.
  - The STOCK Act requires the Senate to maintain an electronic filing system for financial disclosure reports.
  - Annual, new filer, termination, and periodic transaction reports are distinct report types.
  - Periodic Transaction Reports do not receive extensions, so PTR recency can be monitored independently from annual filings.

### House Clerk financial disclosure site for comparison

- URL: <https://disclosures-clerk.house.gov/FinancialDisclosure>
- Findings:
  - The House Clerk site explicitly offers a “Download Financial Disclosure Reports” path.
  - The existing House pipeline can keep its current behavior; Senate should not be shoehorned into House-specific assumptions because Senate eFD has different access, metadata, and report rendering.

### Public/open-source approaches used only as reference

- Public projects and datasets show that Senate PTR extraction is feasible by:
  - accepting the public-search acknowledgement,
  - querying the search-result endpoint for PTR report metadata,
  - visiting individual PTR pages,
  - parsing HTML or print-rendered tables,
  - normalizing rows into transaction records.
- These are references, not direct dependencies. Trawl should not import third-party datasets unless licensing, attribution, and data freshness are explicitly approved.

## Answers to investigation questions

### 1. Is there an official downloadable Senate disclosure database or structured export?

No clearly advertised official bulk download for Senate financial disclosure/PTR data was found. The official public access path is the Senate eFD search site. The Senate public disclosure landing page advertises compressed XML downloads for gift/travel data, not for Senate financial disclosure PTRs.

### 2. What format is available?

Known/likely formats:

- Search UI and search-result metadata from eFD.
- Individual report pages under `efdsearch.senate.gov/search/view/...`.
- Print/PDF renderings for reports.
- Some reports are electronically generated and table-like; older/paper filings may be PDF/scanned or less structured.

Not confirmed as officially published for PTR bulk import:

- bulk CSV,
- bulk XML,
- documented public API contract.

### 3. Does it include transaction-level data or only report metadata?

The eFD search layer appears to provide report metadata. Transaction-level data is available inside individual PTR report pages or their printable/PDF representations. The importer should therefore be two-stage: discover report metadata first, then fetch and parse each PTR report for transaction rows.

### 4. Candidate field availability

| Field | Availability | Notes |
| --- | --- | --- |
| Senator name | Yes | Search result/report header can identify filer. Needs roster matching. |
| Filing date | Yes | Report header/search metadata. |
| Transaction date | Yes for PTR rows | Must parse row table. |
| Owner | Yes for PTR rows | Values such as Self, Joint, Spouse, Dependent Child need mapping. |
| Transaction type | Yes for PTR rows | Purchase/sale/exchange values may need cleanup. |
| Asset name | Yes for PTR rows | Not guaranteed normalized. |
| Ticker | Often for electronically generated stock rows | May be blank/missing for non-public securities, bonds, funds, or bad entry. |
| Amount range | Yes for PTR rows | Existing amount-range parser can likely be reused after label cleanup. |
| Document URL/id | Yes | eFD report URLs include stable-looking UUIDs; store as `sourceUrl` and use for idempotency. |

### 5. How Senate differs from House PTR data

- Senate eFD is an electronic disclosure workflow with searchable report pages; House PTR import currently handles House Clerk disclosure documents.
- Senate search has an explicit acknowledgement gate and statutory use restrictions before access.
- Senate report IDs are URL UUIDs; House document IDs/links differ.
- Senate PTR rows can be table-like and easier than scanned House PDFs when electronically filed, but paper/scanned Senate filings still require fallback parsing or deferral.
- Senate includes Senators, former Senators, candidates, and staff/officers; Trawl should initially scope to current Senators that match the current roster.

## Legal and usage cautions

This is not legal advice. Before production import, confirm intended use with counsel or a project owner.

Important constraints:

- eFD access requires acknowledgement that reports may not be obtained or used for unlawful purposes, most commercial purposes other than news/communications media dissemination to the general public, credit-rating decisions, or solicitation of money for political/charitable/other purposes.
- The importer must keep source attribution and deep links back to official filings.
- Use conservative rate limits, cache fetched metadata/report pages, and avoid bypassing technical controls.
- Do not enrich or expose reports in a way that implies creditworthiness, donor targeting, fundraising, or personalized investment advice.
- Keep Trawl’s existing disclaimers that data may be delayed, incomplete, amended, or unavailable and that Trawl does not recommend buying or selling securities.

## Proposed normalized mapping

Existing `disclosures` fields can support a Senate PTR MVP without schema changes:

| Existing field | Senate PTR source | Normalization |
| --- | --- | --- |
| `politicianId` | matched current Senator filer | match by Bioguide if available, otherwise normalized name/state/chamber. |
| `ticker` | PTR row ticker | uppercase and trim; nullable when missing. |
| `assetName` | PTR row asset name | required; fallback to ticker or raw asset label if necessary. |
| `assetType` | PTR row asset type | map known values to `stock`, `etf`, `option`, `other`; preserve broad category only. |
| `tradeType` | PTR row transaction type | map purchase/sale/exchange and variants. |
| `ownerType` | PTR row owner | map Self, Spouse, Joint, Dependent Child, Unknown. |
| `amountMin` / `amountMax` | PTR row amount range | reuse amount-band parsing. |
| `amountRangeLabel` | PTR row amount range | preserve raw label after whitespace normalization. |
| `tradeDate` | PTR row transaction date | parse as date; reject impossible/future dates. |
| `filingDate` | PTR report filed date | parse from report metadata/header. |
| `filingLagDays` | computed | `filingDate - tradeDate` when both exist. |
| `sourceUrl` | report URL | store canonical `/search/view/ptr/{uuid}/` or print URL. |
| `sourceLabel` | constant | use `senate-efd-ptr`. |

Fields that cannot be reliably mapped without additional schema or source metadata:

- Original Senate report UUID as a first-class idempotency key separate from `sourceUrl`.
- Amendment relationship to an original report.
- Transaction row number/id when a report is amended or reordered.
- Raw comments/notes.
- Staff/candidate filer type if Trawl later imports non-current-member reports.

A no-migration MVP can use a deterministic duplicate key in importer logic composed from `sourceUrl`, normalized filer, row index, transaction date, owner, trade type, ticker/asset name, and amount range. A later migration may be justified if duplicate diagnostics prove this is insufficient.

## Recommended importer phases

### Phase 0: report metadata discovery

Build `senate:discover` only after approving eFD access handling.

Responsibilities:

- Read current Senators from `politicians` where `chamber = 'senate'` and `isActive = true`.
- Submit conservative eFD searches for report type PTR and recent submitted-date windows.
- Cache raw search responses/pages under a local ignored cache directory.
- Normalize report metadata: report UUID, filer name, office/state when available, report type, filing date, view URL, print URL if available.
- Match metadata to Trawl politicians without writing disclosures.
- Output diagnostics for unmatched filers, duplicate report IDs, and report counts by month.

### Phase 1: transaction extraction proof of concept

Build `senate:import:poc` or update the existing placeholder only after Phase 0 is stable.

Responsibilities:

- Fetch a very small approved sample of PTR reports.
- Parse transaction tables from HTML first; use PDF/text extraction only as fallback.
- Emit JSON fixtures with raw rows and normalized candidate rows.
- Do not write to production tables by default.
- Measure row extraction confidence and identify scanned/paper failure cases.

### Phase 2: normalize to disclosure rows

Build `senate:normalize`.

Responsibilities:

- Convert extracted rows to existing `disclosures` insert candidates.
- Apply owner, trade type, amount range, date, asset type, and ticker normalization.
- Enforce idempotency with deterministic duplicate keys before inserts.
- Start with current Senators and PTR-only rows; exclude annual holdings and candidate/staff reports.
- Insert with `sourceLabel = 'senate-efd-ptr'` only after dry-run diagnostics pass.

### Phase 3: scoring/performance integration

Responsibilities:

- Run the existing signal recalculation/performance backfill pipeline against newly inserted disclosure rows.
- Do not alter scoring formulas.
- Compare Senate coverage metrics separately from House metrics.
- Add pipeline health checks that report Senate import freshness, unmatched reports, skipped scanned filings, and duplicate candidates.

## Recommended scripts to build later

- `senate:discover` — fetch/cache report metadata and report matching diagnostics; no disclosure writes.
- `senate:import:poc` — parse a small set of PTR reports to JSON fixtures; dry-run by default.
- `senate:normalize` — normalize approved extracted rows and insert idempotently into `disclosures`.
- `senate:diagnose` — report freshness, duplicates, unmatched senators, parser failures, amount/ticker gaps, amendment candidates, and source URL coverage.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Scanned or paper PDFs | Start with electronic PTR HTML; mark non-table reports as skipped for manual/parser backlog. |
| Inconsistent asset names | Preserve raw `assetName`; normalize tickers separately; do not infer tickers unless confidence is high. |
| Missing ticker | Import rows with nullable ticker only if useful for politician coverage; scoring already prioritizes ticker-backed signals. |
| Owner normalization | Maintain a strict mapping and send unknown owner labels to diagnostics. |
| Amendment filings | Detect amendment report types/labels and avoid overwriting original rows until amendment semantics are understood. |
| Duplicates/idempotency | Use source URL + row fingerprint in importer logic; add a schema key only if diagnostics prove necessary and migration is approved. |
| Terms/use restrictions | Keep acknowledgements explicit in script docs, rate-limit requests, and do not use data for prohibited purposes. |
| eFD endpoint instability | Cache raw responses, retry with exponential backoff, and keep a dry-run diagnose mode. |
| Filer scope creep | Begin with current Senators only; candidates/staff/officers are out of scope for Trawl’s current roster UX. |

## Recommendation

Do not build the full Senate importer in this pass. Build a separate Senate pipeline after approval, beginning with metadata discovery and a small transaction extraction proof-of-concept. If the POC confirms that current Senator PTR pages can be parsed consistently from official eFD HTML, feed normalized PTR rows into the existing `disclosures` table using `sourceLabel = 'senate-efd-ptr'`, then run the existing scoring/performance pipeline unchanged.

## Phase 0 implementation notes (May 28, 2026)

Phase 0 is implemented as a dry-run metadata discovery command:

```bash
npm run senate:discover -- --roster-only
SENATE_EFD_ACKNOWLEDGED=true npm run senate:discover -- --limit=50 --days=90
SENATE_EFD_ACKNOWLEDGED=true npm run senate:discover -- --json --limit=50 --days=90
```

The command intentionally performs no disclosure inserts and does not call the existing House PTR importer. It loads active Senate roster rows from `politicians` where `chamber = 'senate'` and `is_active = true`, then only attempts Senate eFD requests when the operator explicitly sets `SENATE_EFD_ACKNOWLEDGED=true` after reviewing and accepting the public eFD acknowledgement at <https://efdsearch.senate.gov/search/home/>.

### Access and legal posture

- The official public eFD site requires acknowledgement of Ethics in Government Act use restrictions before search access.
- The script does not silently bypass that acknowledgement. Without `SENATE_EFD_ACKNOWLEDGED=true`, it emits diagnostics and exits with a blocked status before making eFD requests.
- The script only targets the public eFD acknowledgement page and report metadata search endpoint; it does not attempt CAPTCHA bypass, credentialed access, hidden administrative paths, or transaction-row scraping.
- Operators must not use reports for prohibited purposes, including credit decisions, fundraising/solicitation, unlawful use, or personalized investment advice.

### Metadata discovery behavior

When acknowledged, the script uses a conservative DataTables metadata query for Senator PTR reports (`report_types=[11]`, `filer_types=[1]`) over a recent submitted-date window. It caches raw home/acknowledgement/search responses under `tmp/senate-disclosures-cache/`, which is ignored by git, and rate-limits requests with a default 1.5 second delay and maximum page size of 25.

Report matching is diagnostics-only:

1. Match by `bioguideId` if the source row exposes one.
2. Otherwise match by normalized filer name within active Senate roster rows.
3. Use state as an ambiguity breaker if the source row exposes a state.

The diagnostics include current senators loaded, metadata reports discovered, matched/unmatched counts, report types, discovered filing-date range, sample matched/unmatched records, skipped/failure reasons, cache/rate-limit settings, and whether discovered URLs look like PTR view URLs that could support transaction extraction in a later phase.

### Example output shape

```json
{
  "mode": "discovered",
  "dryRun": true,
  "source": "official Senate eFD public search",
  "currentSenatorsLoaded": 100,
  "metadataReportsDiscovered": 50,
  "matchedToRoster": 48,
  "unmatched": 2,
  "reportTypesFound": { "Periodic Transaction Report": 50 },
  "dateRangeDiscovered": { "start": "2026-03-01", "end": "2026-05-28" },
  "transactionExtractionPossible": {
    "possibleFromDiscoveredReportUrls": true,
    "possibleCount": 50,
    "notPossibleCount": 0
  },
  "sampleMatchedReports": [],
  "sampleUnmatchedReports": [],
  "skippedOrFailureReasons": []
}
```

### Phase 0 limitations discovered

- There is still no clearly advertised official bulk CSV/XML/JSON export for Senate financial disclosure PTR metadata.
- The eFD metadata endpoint is an undocumented web-UI DataTables endpoint rather than a formally documented public API contract; Phase 0 therefore caches raw responses and keeps output diagnostic-only.
- Local execution requires a configured database URL so the script can validate the active Senate roster before matching.
- In the current validation container, direct command-line access to `efdsearch.senate.gov` returned a proxy-level `403` to `curl`, so live eFD metadata discovery must be tested from a network allowed to access the official public site.

### Phase 1 recommendation

After Phase 0 metadata matching is reviewed, Phase 1 should fetch a small approved sample of matched PTR view URLs, parse transaction tables into JSON fixtures, and compare parsed owner/ticker/asset/type/amount/date fields against original report pages. Phase 1 should remain dry-run by default and should not insert disclosures until idempotency, amendment handling, source URL coverage, and parser failure diagnostics are approved.
