# Aurora Bank — Earn Products Service

A proof-of-concept HTTP service that surfaces Meridian Earn strategies to Aurora Bank's
customers, applying Aurora's business rules (APY threshold, tiered eligibility) and
returning a clean, sorted JSON array ready for Aurora's React Native app.

Built for the Solutions Engineering take-home assessment. See `ASSESSMENT.md` for the brief
and `solution-design-note.md` for the integration handoff.

## Running

```bash
docker-compose up
```

The service starts on `http://localhost:3000` — no env vars, credentials, or setup needed.

```bash
curl 'http://localhost:3000/earn-products?tier=standard'
curl 'http://localhost:3000/earn-products?tier=premium'
curl 'http://localhost:3000/earn-products?tier=private'
```

`tier` is required and must be `standard`, `premium`, or `private`. Each item:

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

On bad input or unavailable/malformed data the service returns a structured error — never a
stack trace: `{ "error": { "code": "INVALID_TIER", "message": "..." } }`.

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

- **APY from `apr_estimate.low`, in exact decimal.** Strategies carry an APR *range*, not an
  APY. We take the conservative floor — a compliance-driven bank should not present a rate
  the customer cannot reliably meet — and convert APR→APY with `APY = (1 + APR/n)^n - 1`,
  compounding only when `auto_compound` is effectively on. All rate maths — the conversion,
  the hard ≥3% threshold, and the APY sort — runs on `big.js` decimals, never IEEE-754
  float; the float boundary is only the JSON response, where `apyValue` is a number. This
  keeps a rate like POL's `2.9999999999999999` (which parses to the double `3.0`) correctly
  below 3%, and is the precision posture a regulated bank's compliance rules call for.
- **`big.js` for the rate maths, not `decimal.js`.** The APY formula raises to `n` =
  compounding periods per year — a count of *discrete* payout events (a weekly strategy
  credits ~52 times a year, not 52.14), so `n` is a whole number. `big.js` `pow` with an
  integer exponent is *exact*: repeated multiplication, no rounding. `decimal.js` allows a
  fractional exponent, but computes `pow` as a rounded `exp(y·ln x)` — so a fractional `n`
  would trade an exact integer power for a rounded transcendental one, with no gain in
  correctness — and it is the larger dependency. `decimal.js` would be warranted only for
  continuous compounding or a period count beyond `pow`'s ±1e6 limit; neither applies here.
- **`flex` strategies are excluded entirely.** Meridian's `flex` ("Meridian Rewards") is an
  account-wide passive yield, not a per-strategy allocation a customer can pick — so it is
  not a catalog product and never appears in `/earn-products`, for any tier. Some `flex`
  records in the source data carry `can_allocate: true`, which contradicts Meridian's model;
  the exclusion keys off the lock type, not that flag.
- **Tier model by structural signal.** Among catalog strategies, `instant` is instant-access
  — visible to every tier, Standard included. `bonded`/`hybrid`/`timed` carry a withdrawal
  lock (unbonding period, exit queue, or fixed term) and are restricted to Premium/Private.
  The classification reads the lock structure, not just the type label, so unknown future
  lock types default to restricted.
- **`can_allocate: false` strategies are dropped.** The `/private/` response is account-
  scoped; if Aurora's account cannot allocate, customers cannot invest.
- **Fail-closed errors.** Any malformed/unavailable data yields a structured error object.

Full reasoning: `solution-design-note.md`.

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
  has no product-name field. For `hybrid` (DeFi vault) strategies the lock word is
  deliberately omitted, so the name reads `USDC DeFi Vault` rather than duplicating "vault".
- **`apyDisplay`** uses a fixed `%` format; true per-locale formatting is a future step.
- **APY compounding is capped at daily.** The compounding-period count `n` is a whole number
  (payouts are discrete events; `big.js` `pow` takes an integer exponent). `n` is capped at
  365: compounding finer than daily shifts the APY by less than the displayed 2-decimal
  precision, while `pow`'s cost climbs steeply with `n` — an hourly payout would otherwise
  take ~25 s to compute. A frequency over ~2 years rounds to under one period a year and is
  treated as non-compounding (APY = APR). Meridian's data uses weekly-to-monthly frequencies,
  well inside both bounds.
- **Unknown paths return Express's default `404`.** The service exposes one route; an
  unknown path falls through to Express's built-in `404` (plain text, not a stack trace).
  A structured JSON `404` body is a small production follow-up. Errors that escape the
  route handler itself are caught by a backstop error-handler middleware and returned as a
  structured error.
- **`PORT=0`** (asking the OS for a free port) is treated as unset and falls back to 3000.
- **Data is read once and cached** for the process lifetime — no auth, rate limiting, or
  observability either, all out of scope for a PoC. A concurrent burst of requests during
  the very first load may read the `data/` directory more than once (harmless — the result
  is identical); a production cache would use a TTL and de-duplicate in-flight loads.

## Development

```bash
npm install
npm test          # vitest — unit + endpoint tests
npm run build     # tsc → dist/
npm run dev       # tsx watch (local, reads ./data)
```
