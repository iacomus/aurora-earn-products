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
3. **HTTP** (`src/routes/`, `src/app.ts`, `src/server.ts`) — a thin Express layer.

Every `*.json` file in `data/` is treated as a captured API response and classified by
envelope shape, so graders can add files freely.

## Key decisions

- **APY from `apr_estimate.low`.** Strategies carry an APR *range*, not an APY. We take the
  conservative floor — a compliance-driven bank should not present a rate the customer
  cannot reliably meet — and convert APR→APY with `APY = (1 + APR/n)^n - 1`, compounding
  only when `auto_compound` is effectively on.
- **Tier model by structural signal.** A strategy is instant-access (Standard-eligible) when
  its lock type has no unbonding period, exit queue, or fixed term — covering `instant` and
  `flex`. `bonded`/`hybrid`/`timed` are Premium/Private only.
- **`can_allocate: false` strategies are dropped.** The `/private/` response is account-
  scoped; if Aurora's account cannot allocate, customers cannot invest.
- **Fail-closed errors.** Any malformed/unavailable data yields a structured error object.

Full reasoning: `solution-design-note.md`.

## Dependencies

| Dependency | Purpose | Why it is safe |
|---|---|---|
| `express` | HTTP server and routing | Industry-standard, MIT-licensed, no native dependencies, maintained by the OpenJS Foundation. Used only to receive one local request. |
| `zod` | Runtime validation of the Meridian JSON, which drives the structured-error requirement | MIT-licensed, zero dependencies, no native code, no network or filesystem access. |

Dev-only: `typescript`, `tsx`, `vitest`, `supertest` — not present in the runtime image.

The service makes **no outbound network calls at runtime** — all data comes from `data/`.

## Known limitations

- **`flex` allocation model.** In Meridian's real product `flex` ("Meridian Rewards") is an
  account-wide toggle, not a per-strategy allocation. It is surfaced here as a normal
  catalog item; a production frontend would treat it differently.
- **Per-customer geography.** Meridian filters strategies by Aurora's *account* region; finer
  per-customer geo-eligibility would need the customer's country as an input.
- **`displayName` is synthesised** from asset + lock + yield-source words — the source data
  has no product-name field.
- **`apyDisplay`** uses a fixed `%` format; true per-locale formatting is a future step.
- No auth, rate limiting, caching, or observability — out of scope for a PoC. Data is read
  once and cached for the process lifetime.

## Development

```bash
npm install
npm test          # vitest — unit + endpoint tests
npm run build     # tsc → dist/
npm run dev       # tsx watch (local, reads ./data)
```
