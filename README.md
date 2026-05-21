# Aurora Bank — Earn Products Service

A proof-of-concept HTTP service that surfaces Meridian Earn strategies to Aurora Bank's
customers, applying Aurora's business rules (APY threshold, tiered eligibility) and
returning a clean, sorted JSON array ready for Aurora's React Native app.

Built for the Solutions Engineering take-home assessment. See `ASSESSMENT.md` for the brief
and `solution-design-note.md` for the integration handoff.

## Running

```bash
docker-compose up      # or, on Docker Compose v2:  docker compose up
```

The service starts on `http://localhost:3000` — no env vars, credentials, or setup needed.

```bash
curl 'http://localhost:3000/earn-products?tier=standard'
curl 'http://localhost:3000/earn-products?tier=premium'
curl 'http://localhost:3000/earn-products?tier=private&locale=de-DE'
```

`tier` is required (`standard`, `premium`, or `private`). `locale` is optional — a BCP 47
tag (e.g. `de-DE`, `tr-TR`) that localises the `apyDisplay` string; it defaults to
`en-US`. Each item:

```json
{
  "strategyId": "ESRFUO3-Q62XD-WIOIL7",
  "asset": "DOT",
  "displayName": "DOT Flexible Staking",
  "lockType": "instant",
  "apyDisplay": "8.32%",
  "apyValue": 8.32,
  "eligibleTiers": ["Standard", "Premium", "Private"],
  "minimumAmount": "0.01"
}
```

On bad input, an unknown route, or unavailable/malformed data the service returns a
structured error — never a stack trace: `{ "error": { "code": "INVALID_TIER", "message": "..." } }`.

## Architecture

Three layers, so the business logic is isolated and unit-testable without I/O:

1. **Meridian API client** (`src/meridian/`) — a `MeridianEarnClient` interface modelling the two
   Meridian endpoints. `FileMockMeridianClient` *mocks* those calls, reading captured responses
   from `data/`. It is the only component that would change for a live integration: a
   production `HttpMeridianClient` would implement the same interface against
   `POST /private/Earn/Strategies` and `GET /public/Assets`.
2. **Domain** (`src/domain/`) — pure functions: APR→APY conversion, tier model,
   transform/filter, orchestration. No I/O.
3. **HTTP** (`src/routes/`, `src/app.ts`, `src/server.ts`) — a thin Express layer, with a
   backstop error-handler middleware so every failure leaves as a structured response.

Every `*.json` file in `data/` is treated as a captured API response and classified by
envelope shape, so graders can add files freely.

## Key decisions

- **APY from `apr_estimate.low`, in exact decimal.** Strategies carry an APR *range*, not
  an APY. We take the conservative floor — a compliance-driven bank should not present a
  rate a customer cannot reliably meet — and convert with `APY = (1 + APR/n)^n - 1`,
  compounding only when `auto_compound` is on. All rate maths runs on `big.js` decimals,
  never IEEE-754 float, so a float-rounding artefact never crosses the 3% threshold (POL's
  `2.9999…`, which parses to the double `3.0`, stays correctly below it).
- **`big.js`, not `decimal.js`.** The APY exponent is an integer period count, and
  `big.js`'s integer `pow` is exact; `decimal.js` would add weight with no added
  correctness here.
- **`flex` strategies are excluded entirely.** Meridian's `flex` ("Meridian Rewards") is an
  account-wide passive yield, not a product a customer picks — so it is not a catalog item
  and never appears in `/earn-products`, for any tier.
- **Tier model by structural signal.** `instant` strategies are instant-access — visible
  to every tier. `bonded`/`hybrid`/`timed` carry a withdrawal lock and are restricted to
  Premium/Private. The classification reads the lock structure, not the type label, so an
  unknown future lock type defaults to restricted.
- **`can_allocate: false` strategies are dropped.** The `/private/` response is
  account-scoped; if Aurora's account cannot allocate, customers cannot invest.
- **Localised `apyDisplay` via `Intl`.** An optional `?locale` (BCP 47 tag) formats the
  display string per the customer's locale — `Intl.NumberFormat`, a Node built-in, so no
  dependency. `apyValue` stays a raw number; `locale` defaults to `en-US`.
- **Fail-closed errors.** Any malformed or unavailable data yields a structured error
  object, never a partial result.

Deeper reasoning lives in the code comments and `solution-design-note.md`.

## Dependencies

| Dependency | Purpose | Why it is safe |
|---|---|---|
| `express` | HTTP server and routing | Industry-standard, MIT-licensed, no native dependencies, maintained by the OpenJS Foundation. Used only to receive one local request. |
| `zod` | Runtime validation of the Meridian JSON, which drives the structured-error requirement | MIT-licensed, zero dependencies, no native code, no network or filesystem access. |
| `big.js` | Exact-decimal arithmetic for all APY maths — APR→APY conversion, the ≥3% threshold, and sort order — keeping rate logic off IEEE-754 float | MIT-licensed, zero dependencies, no native code, no network or filesystem access. |

Dev-only: `typescript`, `tsx`, `vitest`, `supertest` — not present in the runtime image.

The service makes **no outbound network calls at runtime** — all data comes from `data/`.

## Known limitations

- **Per-customer geography.** Meridian filters strategies by Aurora's *account* region; finer
  per-customer geo-eligibility would need the customer's country as an input.
- **`displayName` is synthesised** from asset + lock + yield-source words — the source data
  has no product-name field. Real product names would come from a content source.
- **APY compounding is capped at daily** — the compounding-period count is capped at 365.
  Compounding finer than daily shifts the APY by less than the displayed 2-decimal
  precision, so the cap costs no visible accuracy. Meridian's data uses weekly-to-monthly
  payout frequencies, well inside the cap.
- **Data is read once and cached** for the process lifetime — with no auth, rate limiting,
  or observability, all out of scope for a PoC. A production cache would add a TTL and
  de-duplicate concurrent in-flight loads.

## Development

```bash
npm install
npm test          # vitest — unit + endpoint tests
npm run build     # tsc → dist/
npm run dev       # tsx watch (local, reads ./data)
```
