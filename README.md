# Aurora Bank — Earn Products Service

A proof-of-concept HTTP service that surfaces Meridian Earn strategies to Aurora Bank's
customers, applying Aurora's business rules (APY threshold, tiered eligibility) and
returning a clean, sorted JSON array ready for Aurora's React Native app.

Built for the Solutions Engineering take-home assessment. See `solution-design-note.md` for
the integration handoff. `docs/` holds the design spec
and implementation plan written while building this, and `scripts/build-transcript.py`
generated `ai-transcript.md` — process artefacts, not part of the four submission
deliverables.

## Running

```bash
docker-compose up      # or, on Docker Compose v2:  docker compose up
```

The service starts on `http://localhost:3000` — no env vars, credentials, or setup needed.

## Exercising the endpoint

`GET /earn-products` takes a required `tier` and an optional `locale`:

- **`tier`** — `standard`, `premium`, or `private` (case-insensitive). Standard customers
  see only instant-access strategies; Premium and Private also see lock-up strategies.
- **`locale`** — a BCP 47 tag that localises the `apyDisplay` string. Optional; defaults
  to `en-US`.

```bash
# Standard — instant-access strategies only
curl 'http://localhost:3000/earn-products?tier=standard'

# Premium / Private — full catalog, incl. bonded/hybrid/timed lock-up strategies
curl 'http://localhost:3000/earn-products?tier=premium'
curl 'http://localhost:3000/earn-products?tier=private'

# Localised apyDisplay — "8,32 %" (de-DE) or "%8,32" (tr-TR) instead of "8.32%"
curl 'http://localhost:3000/earn-products?tier=premium&locale=de-DE'
curl 'http://localhost:3000/earn-products?tier=premium&locale=tr-TR'
```

A success response is a JSON array, filtered to APY ≥ 3% and sorted by APY descending.
Each item:

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

### Error responses

Bad input, an unknown route, or unavailable/malformed data all return a structured error
object with a stable `code` and an appropriate HTTP status — never a stack trace:

```bash
# 400 — tier omitted
curl 'http://localhost:3000/earn-products'
# {"error":{"code":"INVALID_TIER","message":"tier must be one of: standard, premium, private"}}

# 400 — tier not recognised
curl 'http://localhost:3000/earn-products?tier=gold'
# {"error":{"code":"INVALID_TIER","message":"tier must be one of: standard, premium, private"}}

# 400 — malformed BCP 47 tag
curl 'http://localhost:3000/earn-products?tier=premium&locale=-bad'
# {"error":{"code":"INVALID_LOCALE","message":"locale \"-bad\" is not a valid BCP 47 language tag"}}

# 404 — unknown route
curl 'http://localhost:3000/health'
# {"error":{"code":"NOT_FOUND","message":"No route for GET /health"}}
```

A missing or corrupt `data/` directory surfaces the same way — `DATA_UNAVAILABLE` or
`DATA_MALFORMED` (HTTP 500) — rather than as an unhandled exception.

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
  never IEEE-754 float — so a near-boundary APR like `2.9999999999999999`, which collapses
  to the IEEE-754 double `3.0`, is still read as correctly below the 3% threshold.
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
`npm audit` reports moderate advisories in the `vitest`/`vite`/`esbuild` dev toolchain
(an esbuild dev-server issue); these tools are not in the runtime image, so the running
service is unaffected. The runtime dependencies above carry no advisories.

The service makes **no outbound network calls at runtime** — all data comes from `data/`.

## Known limitations

- **Per-customer geography.** Meridian filters strategies by Aurora's *account* region; finer
  per-customer geo-eligibility would need the customer's country as an input.
- **`displayName` is synthesised** from asset + lock + yield-source words — no Meridian
  endpoint exposes a product or full-asset name. Production would either keep synthesising
  or source names from Aurora's own product catalog.
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
