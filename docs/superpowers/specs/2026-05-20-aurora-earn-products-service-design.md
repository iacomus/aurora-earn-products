# Aurora Bank Earn Products Service — Design

- **Date:** 2026-05-20
- **Status:** Approved design — ready for implementation planning
- **Context:** Solutions Engineering take-home assessment (`ASSESSMENT.md`)

## 1. Problem

Build a small HTTP service that surfaces Meridian Earn strategies to "Aurora Bank", a
fictional European neobank. The service reads mock Meridian API responses from local JSON
files, applies Aurora's business rules, and exposes one endpoint:

```
GET /earn-products?tier={standard|premium|private}
```

It returns a JSON array of earn products, filtered and formatted for Aurora's React Native
app, sorted by APY descending. It ships with a `Dockerfile` + `docker-compose.yml` so that
`docker-compose up` alone starts it on `http://localhost:3000`.

The runtime has **no outbound network**. All data comes from the mounted `data/` directory.

## 2. Decisions locked in

These are the judgment calls the assessment asks us to make deliberately and document.
Each is settled; the reasoning belongs in `README.md` and `solution-design-note.md`.

| Decision | Choice | Reasoning |
|---|---|---|
| Language | TypeScript | Fastest path to a clean, complete submission in the 2–4h budget. |
| Which `apr_estimate` value is "the APY" | `low` (conservative floor) | Aurora's compliance team will not present sub-threshold yields. Using the floor means we never display a rate the customer cannot reliably meet. Drives both the filter and the displayed value. |
| `flex` / `hybrid` / `timed` → tier model | Structural rule, not type label | The brief's tier rules only name `instant` and `bonded`. We classify by **structural signal**: a strategy is *instant-access* if it has no unbonding period and no fixed term. |
| Does `flex` count as instant-access? | Yes | Per Meridian docs, `flex` ("Meridian Rewards") is earning on spot balances — the *most* liquid type. `instant` + `flex` → Standard-eligible. `bonded` + `hybrid` + `timed` → Premium/Private only. |
| Keep `flex` in the catalog? | Yes | `flex` is account-wide with no manual allocation in Meridian's real product, but the mock data deliberately plants four edge cases on `flex` strategies (POL, XXTZ, ALGO, MINA). Dropping `flex` would skip them. The allocation nuance becomes a documented integration caveat. |
| APR vs APY | Convert APR → APY | The data carries APR (`apr_estimate`); the output and brief require APY. |
| APY formula | `APY = (1 + APR/n)^n − 1` | Meridian's documented formula. `n` = compounding periods/year. |
| Compounding gate | Gate on `auto_compound` | Compound only when effectively on (`enabled`, or `optional` with `default: true`). Otherwise APY = APR — no compounding the customer will not actually receive. |
| Error handling | Fail-closed, structured error | On any malformed/unavailable data, return a structured error object naming the cause — never a stack trace, never silent partial degradation. |
| Threshold boundary | `APY ≥ 3%` | Per the brief. Applied to the *unrounded* computed APY. |
| `can_allocate: false` | Drop the strategy | `strategies.json` mocks the *authenticated* `POST /private/Earn/Strategies` — the response is scoped to Aurora's master account. `can_allocate: false` is read at face value: Aurora's account cannot allocate, so the strategy is not a real catalog item. Documented in §13. |
| `allocation_restriction_info` | Explanatory only — not a tier input | Carries the *reason* `can_allocate` is false. Its `tier` value is Meridian's account-*verification* tier, unrelated to Aurora's customer tiers — never mapped onto the tier model. Documented in §13. |
| Asset `status` ≠ `enabled` | Drop the strategy | A non-enabled asset (`disabled` / `workinprogress` / `depositonly` / …) is not operational platform-wide — surfacing an earn product for it is a correctness/compliance issue. Deliberate data-quality safeguard (§13). |
| Envelope `error` array non-empty | Structured error | A populated `error` array is an upstream API failure (e.g. `["EAPI:Bad request"]`). The brief says handle upstream errors — we fail-closed and surface the Meridian error string. |

### Naming trap (documented for the reader)

The brief says Standard sees *"flexible/instant-access strategies (`lock_type: instant`)"*.
Per Meridian's docs, "flexible" is the **UI name for `instant`** — not the `flex` lock type.
"Flexible" (the brief's word) ≠ `flex` (the data's lock type). They are different things.

## 3. Architecture

Three layers, so the business logic that carries risk is isolated and unit-testable
without I/O:

1. **Meridian API client layer** (`meridian/`) — a `MeridianEarnClient` interface modelling the
   two Meridian Earn endpoints. The shipped `FileMockMeridianClient` *mocks those calls*,
   reading captured API responses from `data/` instead of the network. It is the only
   component that would change for a live integration — a production `HttpMeridianClient`
   implements the same interface against `POST /private/Earn/Strategies` and
   `GET /public/Assets`.
2. **Domain layer** — pure functions. Transforms a raw strategy + asset map into an
   `EarnProduct`, computes APY, applies the filters and tier model, sorts.
3. **HTTP layer** — a thin Express route. Validates the `tier` query param, calls the
   domain layer, maps domain errors onto HTTP responses.

The domain layer performs no I/O — it is pure functions over data the client returned.

### Module layout

```
src/
  server.ts                bootstrap — listen on 0.0.0.0:3000
  app.ts                   Express app + route wiring
  config.ts                DATA_DIR (default <cwd>/data), PORT (default 3000)
  errors.ts                AppError types + structured error shape
  routes/earn-products.ts  validate ?tier, call service, map errors → HTTP status
  meridian/client.ts         MeridianEarnClient interface + Meridian envelope / raw types
  meridian/schema.ts         zod schemas: Meridian envelope, strategy item, asset entry
  meridian/mock-client.ts    FileMockMeridianClient — glob data/, classify captures, validate, merge
  domain/apy.ts            APR → APY conversion (pure)
  domain/tiers.ts          lock_type → access model → eligibleTiers (pure)
  domain/transform.ts      raw strategy + asset map → EarnProduct | excluded (pure)
  domain/earn-products.ts  orchestrate: client → transform → filter by tier → sort
test/
  apy.test.ts              conversion + compounding-gate cases
  tiers.test.ts            all five lock types → eligibleTiers
  transform.test.ts        asset resolution, APY filter boundaries, displayName
  mock-client.test.ts      capture classification, multi-file merge, malformed-capture errors
  earn-products.test.ts    end-to-end endpoint test per tier
Dockerfile
docker-compose.yml
```

## 4. Meridian API client (mock)

`MeridianEarnClient` models the two Meridian Earn endpoints the brief names:

```ts
interface MeridianEarnClient {
  listStrategies(): Promise<RawStrategy[]>;   // POST /private/Earn/Strategies
  listAssets(): Promise<AssetMap>;            // GET  /public/Assets
}
```

The methods are `async`, so the interface is a faithful stand-in for an HTTP client — a
production `HttpMeridianClient` implements the same signatures with no downstream change.

`FileMockMeridianClient` is the shipped implementation. It treats **each `*.json` file in
`data/` as a captured response** from one of the two endpoints, identifies which by
envelope shape, validates it, and returns the merged result per endpoint. It performs no
network I/O, satisfying the runtime-network-closed constraint. The rest of this section
describes its internals.

### Envelope

Both files use Meridian's envelope: `{ "error": [], "result": ... }`.
- A **strategies** file: `result.items` is an array.
- An **assets** file: `result` is a keyed object of asset metadata.
- The `error` array carries upstream API errors as `"<severity><category>: <description>"`
  strings (e.g. `["EAPI:Bad request"]`). A **non-empty `error` array** on a recognised data
  file is an upstream failure → **structured error** (fail-closed).
- `result.next_cursor` is a pagination cursor. We read static files with no runtime network,
  so there is no next page to fetch — `next_cursor` is **ignored**.

### Globbing and shape detection

Graders add JSON files with **arbitrary names** during scoring, so files are classified by
**shape, not filename**:

- Glob every `*.json` in `DATA_DIR`.
- For each file: parse JSON, then inspect it.
  - Invalid JSON → **structured error**.
  - Meridian envelope with a **non-empty `error` array** → **structured error**.
  - `result.items` is an array → **strategies file**.
  - `result` is a non-array object whose values are objects carrying an `altname` string
    → **assets file**.
  - Valid JSON, recognised as neither → **ignored** (could be unrelated; not an error).
- Collect strategy items from **all** strategies files; merge asset maps from **all**
  assets files. This supports graders splitting data across multiple files.
  - Duplicate asset key across files → last-write-wins.
  - Duplicate strategy `id` across files → dedupe by `id`, last-write-wins, so the output
    never contains two identical `strategyId`s.

### Validation (zod)

`meridian/schema.ts` defines zod schemas for the envelope, a strategy item, and an asset entry.
Schemas are **lenient about unknown keys** (Meridian adds fields; graders add files) but
**strict about the fields we consume**.

- A file recognised as a strategies/assets file but failing schema validation → **structured
  error** (fail-closed), naming the file and the validation problem.
- Field types are **not uniform** — the schema types each explicitly: `apr_estimate.*`,
  `user_min_allocation`, `user_cap`, fees are **strings**; `payout_frequency`, `*_period`,
  `decimals` are **numbers**. `duration_months` is in **months**; every other period is in
  **seconds**.
- `lock_type` and `lock_type.type` are **required** — a strategy missing them → structured
  error (distinct from an *unknown* `type` *value*, which §5.2 handles as `restricted`).
- `apr_estimate` is **optional** on a strategy. Its absence is valid (see MINA) and handled
  by the domain layer, not the schema. If `apr_estimate` is *present*, its `low` must be a
  numeric-parseable string; otherwise → structured error. `high` is optional and unused.

## 5. Domain layer

### 5.1 APR → APY conversion (`domain/apy.ts`)

```
APY = (1 + APR/n)^n − 1
```

- `APR` = `apr_estimate.low` parsed with `Number`, as a fraction (e.g. `"4.0000"` → `0.04`).
- `n` = compounding periods per year = `round(31_536_000 / payout_frequency)`, where
  `payout_frequency` is `lock_type.payout_frequency` in seconds and `31_536_000` = 365 days.
  So weekly (`604800`) → 52, 5-day (`432000`) → 73, 30-day (`2592000`) → 12.
- **Compounding gate** — compounding applies only when `auto_compound` is effectively on:
  - `enabled` → compound
  - `disabled` → no compounding
  - `optional` → follow `default` (`true` → compound, `false` → no compounding)
  - unknown / missing → no compounding (do not invent yield)
- **Fallbacks → APY = APR:**
  - compounding gate is off, OR
  - `payout_frequency` is absent (`n` undeterminable — all `flex` and `hybrid` strategies).

`auto_compound` enum values are **not documented** by Meridian; they are inferred from the
mock data (`enabled`, `disabled`, `optional`). The unknown-value fallback covers graders
adding new values.

### 5.2 Tier model (`domain/tiers.ts`)

Classify each strategy into an **access model**, keyed off **structural signals** in
`lock_type`, not just the `type` label:

- **Restricted** if `lock_type` carries any *withdrawal-side* lock signal:
  `unbonding_period > 0`, `exit_queue_period > 0`, `delayed_withdrawals: true`, a
  `duration_months` / fixed-term field, or `type` ∈ {`bonded`, `hybrid`, `timed`}.
- Else if `type` ∈ {`instant`, `flex`} (no lock signal present) → **instant-access**.
- Else — an **unknown `type`** outside that set → **restricted** (conservative default;
  robust to graders adding new lock types).

`bonding_period` is **not** a restricted-access signal — it delays when rewards *start
accruing*, not when funds can be *withdrawn* (ATOM has `bonding_period: 0` yet is restricted
via its `unbonding_period`). Only withdrawal-side signals gate Standard eligibility.

`eligibleTiers` is derived from the access model:

| Access model | `eligibleTiers` |
|---|---|
| instant-access | `["Standard", "Premium", "Private"]` |
| restricted | `["Premium", "Private"]` |

Premium and Private see everything qualifying, so `eligibleTiers` is always one of these
two values.

> **Not a tier input:** `allocation_restriction_info` plays no part in this model — its
> `tier` value is Meridian's account-*verification* tier, not an Aurora customer tier (§13).
> `can_allocate` *is* used, but as a catalog availability filter (§5.3) — never as a tier
> signal.

### 5.3 Transform + filter + sort (`domain/transform.ts`, `domain/earn-products.ts`)

Pipeline per strategy:

1. Resolve `strategy.asset` (Meridian internal code) against the merged asset map → use the
   `altname` for the output `asset` field (`XETH`→`ETH`, `POL`→`MATIC`, `XADA`→`ADA`).
   A code **not** in the asset map → **structured error** (broken referential integrity is
   malformed data; fail-closed). Resolution runs for every strategy, so a dangling reference
   is caught even on a row a later filter would drop.
2. **Availability filter:** if `can_allocate` is `false`, **drop** the strategy — the
   authenticated `/private/` response states Aurora's account cannot allocate, so it is not
   a real catalog item (see §2). A *drop*, not an error.
3. **Asset-status filter:** if the resolved asset's `status` is not `enabled`, **drop** the
   strategy (a non-operational asset is not surfaceable — see §2). Also a *drop*: the asset
   metadata is valid, the asset just is not available.
4. Compute APY (§5.1). A strategy with **no `apr_estimate`** has no APY (see MINA).
5. **APY filter (hard, never relaxed):** drop any strategy whose APY is `< 3%`, and drop any
   strategy with no APY. Applied to the *unrounded* computed APY.
6. Derive `eligibleTiers` from the tier model (§5.2).
7. Build the `EarnProduct` output object (§6).
8. After all strategies are transformed: filter to those whose `eligibleTiers` includes the
   **requested tier**, then **sort by `apyValue` descending**, tie-broken by `strategyId`
   ascending for deterministic ("stable") output.

## 6. Output shape

Success → a JSON array of objects matching the brief's required shape (verbatim example
from `ASSESSMENT.md`):

```json
{
  "strategyId": "ESETH01",
  "asset": "ETH",
  "displayName": "Ethereum Flexible Staking",
  "lockType": "instant",
  "apyDisplay": "4.25%",
  "apyValue": 4.25,
  "eligibleTiers": ["Standard", "Premium", "Private"],
  "minimumAmount": "0.0001"
}
```

(The brief's `displayName`, `"Ethereum Flexible Staking"`, cannot be reproduced from the
data — see the synthesis note below.)

Field derivations:

| Field | Source |
|---|---|
| `strategyId` | `strategy.id` verbatim |
| `asset` | `altname` of the asset, from the asset map |
| `displayName` | **Synthesised** (see below) |
| `lockType` | `strategy.lock_type.type` verbatim (`instant`/`bonded`/`flex`/`hybrid`/`timed`) |
| `apyValue` | Computed APY (§5.1), as a percentage number rounded to 2 decimals |
| `apyDisplay` | `apyValue` formatted with 2 decimals and a `%` suffix (e.g. `"4.00%"`) |
| `eligibleTiers` | From the tier model (§5.2) |
| `minimumAmount` | `strategy.user_min_allocation` verbatim (kept as a string) |

**`displayName` is synthesised** — the source data has no name field, so the example
`"Ethereum Flexible Staking"` cannot be reproduced (no full asset names, no product names).
We build it from `{altname} {lock-type word} {yield-source word}`:

- lock-type word: `instant`/`flex` → `Flexible`, `bonded` → `Bonded`, `timed` → `Fixed-Term`,
  `hybrid` → (omitted — yield-source word carries it)
- yield-source word: `staking` → `Staking`, `defi` → `DeFi Vault`, `opt_in_rewards` →
  `Rewards`

Examples: `"ETH Bonded Rewards"`, `"DOT Flexible Staking"`, `"USDC DeFi Vault"`,
`"FIL Fixed-Term Staking"`. Documented as a stand-in for real product names.

The filter uses the unrounded APY; only `apyValue`/`apyDisplay` are rounded. A strategy at a
true 2.996% APY is excluded even though it would *display* `"3.00%"` — the real number gates.

## 7. Error model

Success → a plain JSON array — possibly empty (`[]`) if no product qualifies for the
requested tier; an empty result is a success, not an error. Failure → a structured object,
never a stack trace:

```json
{ "error": { "code": "INVALID_TIER", "message": "tier must be one of: standard, premium, private" } }
```

| Condition | HTTP | `code` |
|---|---|---|
| Missing or invalid `tier` query param | 400 | `INVALID_TIER` |
| `DATA_DIR` missing, or no JSON files found | 500 | `DATA_UNAVAILABLE` |
| A data file fails JSON parse / schema validation | 500 | `DATA_MALFORMED` |
| A strategy references an asset code absent from the asset map | 500 | `DATA_MALFORMED` |
| A data file's envelope has a non-empty `error` array (upstream failure) | 500 | `DATA_UPSTREAM_ERROR` |
| Any unexpected error | 500 | `INTERNAL_ERROR` |

`tier` matching is case-insensitive; output tier names are capitalised (`Standard`). A
top-level Express error handler guarantees no raw exception ever reaches the client.

## 8. HTTP layer

- Express. One route: `GET /earn-products`.
- `tier` is required. Missing/invalid → `400 INVALID_TIER`.
- Service listens on `0.0.0.0:3000`.
- A catch-all error handler maps `AppError`s to their status + structured body, and any
  other throwable to `500 INTERNAL_ERROR`.

## 9. Docker

**`Dockerfile`** — multi-stage:
- Builder: `node:22-slim`, `npm ci`, compile TypeScript → `dist/`.
- Runtime: `node:22-slim`, `npm ci --omit=dev`, copy `dist/`, run as the non-root `node`
  user, `EXPOSE 3000`, `CMD ["node", "dist/server.js"]`.

**`docker-compose.yml`:**
```yaml
services:
  earn-products:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data:ro
```
- **No `networks:` block** (default network only — a custom block rejects the submission).
- No env vars, no credentials required.
- `./data` is **bind-mounted read-only** so grader-added files appear without a rebuild.
- `config.ts`: `DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data")`.
  WORKDIR is `/app`, so the default resolves to `/app/data` in the container and `./data`
  for local runs from the repo root.

## 10. Testing

TDD on the domain core — the logic that carries risk. Not exhaustive coverage; focused:

- **`apy.test.ts`** — formula correctness; compounding gate (`enabled` compounds,
  `disabled`/`optional:false` do not); no-`payout_frequency` → APY = APR; `n` derivation.
- **`tiers.test.ts`** — all five lock types → correct access model and `eligibleTiers`;
  `exit_queue_period` / `delayed_withdrawals` force `restricted`; `bonding_period` alone
  does not; unknown lock type → restricted.
- **`transform.test.ts`** — asset code → altname; APY filter boundaries (POL = 3.00% in,
  XXTZ = 2.50% out, AVAX/ALGO out, MINA dropped for missing `apr_estimate`); dangling asset
  code → error; `can_allocate: false` → dropped; non-`enabled` asset status → dropped;
  `displayName` synthesis.
- **`mock-client.test.ts`** — capture classification by shape; multi-file merge; malformed
  capture → structured error; non-empty `error` array → structured error; duplicate `id` /
  asset-key dedupe; non-matching file ignored.
- **`earn-products.test.ts`** — endpoint per tier; invalid tier → 400; sort order; missing
  data dir → 500.

Test runner: `vitest`.

## 11. Dependencies

Each gets a safety note in `README.md`.

| Dependency | Use | Safety note |
|---|---|---|
| `express` | HTTP server / routing | Ubiquitous, MIT, no native deps, mature. |
| `zod` | Runtime schema validation → drives the structured-error requirement | Ubiquitous, MIT, no native deps, no runtime network. |
| `typescript`, `tsx`, `vitest` (dev) | Build + test | Dev-only; not in the runtime image. |

No decimal library: APR strings are parsed as IEEE-754 doubles. This is deliberate — the
brief notes POL's `2.9999…`/`3.0000…` strings *both parse to `3.0`*, and the threshold is
`≥ 3`, so POL lands exactly on the boundary and is **included**. A true decimal type would
change that outcome.

## 12. Worked example

APY computed from `apr_estimate.low`, per §5.1. Pipeline drops, in order: `can_allocate:
false`, asset `status` ≠ `enabled` (none in the provided data), APY `< 3%`, no APY.

| Asset | Lock | APR low | `auto_compound` | APY | `can_allocate` | Result |
|---|---|---|---|---|---|---|
| DOT | instant | 8.0 | enabled (n=52) | 8.32% | true | ✓ Standard, Premium, Private |
| USDC | hybrid | 7.5 | disabled | 7.50% | true | ✓ Premium, Private |
| ETH | bonded | 4.0 | disabled | 4.00% | true | ✓ Premium, Private |
| ADA | instant | 3.0 | enabled (n=73) | 3.04% | true | ✓ Standard, Premium, Private |
| POL | flex | 3.0 | enabled (no freq) | 3.00% | true | ✓ Standard, Premium, Private |
| FIL | timed | 10.0 | disabled | 10.00% | false | ✗ dropped — `can_allocate: false` |
| ATOM | bonded | 9.5 | optional:false | 9.50% | false | ✗ dropped — `can_allocate: false` |
| SOL | bonded | 5.0 | enabled (n=52) | 5.12% | false | ✗ dropped — `can_allocate: false` |
| KSM | instant | 4.25 | enabled (n=52) | 4.34% | false | ✗ dropped — `can_allocate: false` |
| FLR | flex | 6.0 | enabled (no freq) | 6.00% | false | ✗ dropped — `can_allocate: false` |
| XXTZ | flex | 2.5 | enabled (no freq) | 2.50% | true | ✗ dropped — APY < 3% |
| AVAX | instant | 0.5 | enabled | 0.50% | true | ✗ dropped — APY < 3% |
| ALGO | flex | 0.0 | enabled | 0.00% | true | ✗ dropped — APY < 3% |
| MINA | flex | — | enabled | — | true | ✗ dropped — no `apr_estimate` |

Five strategies qualify. Output sorted by APY descending:

- `GET /earn-products?tier=premium` (or `private`) → DOT 8.32%, USDC 7.50%, ETH 4.00%,
  ADA 3.04%, POL 3.00%.
- `GET /earn-products?tier=standard` → instant-access only: DOT 8.32%, ADA 3.04%, POL 3.00%.

The `can_allocate` filter removes five strategies (FIL, ATOM, SOL, KSM, FLR) that would
otherwise qualify — half the catalog. It is the design's highest-impact judgment call; §13
records the reasoning.

## 13. Known limitations / out of scope

Documented in `README.md` / `solution-design-note.md`:

- **`can_allocate` is read at face value, account-scoped.** `strategies.json` mocks the
  *authenticated* `POST /private/Earn/Strategies` — its response is inherently scoped to one
  account (Aurora's master account). The service drops `can_allocate: false` strategies: if
  Aurora's account cannot allocate, its customers cannot invest, so the strategy is not a
  real catalog item. The brief's required output shape has no availability flag, so the
  choice is binary — include or drop. A future revision could instead surface availability
  state. This filter removes five of the ten APY-qualifying strategies in the sample data,
  so it is the design's highest-impact decision.
- **`allocation_restriction_info` is not an Aurora-tier signal.** It carries the *reason*
  `can_allocate` is false. Its `tier` value is Meridian's account-*verification* tier —
  Meridian's docs state Earn *"generally requires Intermediate tier"* — unrelated to Aurora's
  Standard/Premium/Private *customer* tiers despite the shared word. The service never maps
  it onto the tier model; doing so would conflate two unrelated systems.
- **Geographic availability is enforced upstream by Meridian — the service does no
  geo-filtering.** Meridian's docs state `POST /private/Earn/Strategies` *"returns only
  strategies that are available to the user based on geographic region"*: geo-restricted
  strategies are **absent from the response entirely**, not flagged within it. So
  `strategies.json` is already a geographically-scoped view of what Aurora's account may
  offer, and re-implementing a geo filter would duplicate — and risk contradicting —
  Meridian's authoritative determination. Geographic availability is therefore *not* a
  per-strategy field, and is *not* carried in `allocation_restriction_info` (that field
  carries allocation-eligibility reasons such as `tier`, for strategies that *are*
  returned). The one genuine production gap: Meridian filters for **Aurora's account's**
  region, but Aurora's customers span multiple European jurisdictions, so per-customer
  geo-eligibility is finer-grained. Handling it would need the customer's country as an
  input to `/earn-products` plus Aurora's own per-jurisdiction product permissions — out of
  scope for this PoC, and the right "next step toward production" for the design note.
- **`flex` allocation model.** In Meridian's real product, `flex` ("Meridian Rewards") is an
  account-wide toggle with no manual allocation. Surfacing it as a selectable catalog item
  is a simplification; a production integration would treat `flex` differently in the UI.
- **`apr_estimate` is an estimate range.** We take the conservative `low`. The `high` bound
  and the spread are discarded; a production API might expose the range.
- **APY inputs are not all documented.** `auto_compound` enum values and `hybrid`/`timed`
  lock types are absent from Meridian's public docs; behaviour is inferred from the mock data,
  with conservative fallbacks for unknown values.
- **Non-enabled assets are dropped.** A strategy whose asset `status` is not `enabled`
  (`disabled` / `workinprogress` / `depositonly` / …) is excluded. This goes beyond the
  brief's two stated filters as a deliberate data-quality safeguard — Aurora should not
  surface an earn product for an asset that is not operational platform-wide.
- **Some source fields are intentionally unused** — `display_decimals`, `decimals`,
  `allocation_fee`, `deallocation_fee`, `user_cap`, `bonding_rewards` / `unbonding_rewards`.
  Notably `display_decimals` is *not* used to format `minimumAmount` or `apyDisplay`: the
  brief fixes `minimumAmount` as a verbatim string and `apyDisplay` as a plain `%` value.
- **`displayName` is synthesised** — see §6. Real product/marketing names would come from a
  content source.
- **Locale.** `apyDisplay` uses a fixed `"%"` format matching the brief's example. True
  per-locale formatting (Aurora is a European bank) is a production enhancement.
- **No auth, rate limiting, caching, or observability** — out of scope for a PoC; data is
  read fresh from disk per request.

## 14. Deliverables

- Service code + root `Dockerfile` + `docker-compose.yml` — runs via `docker-compose up`.
- `README.md` — architecture, dependency safety notes, known limitations.
- `solution-design-note.md` — one-page external handoff for a mid-level Aurora Bank backend
  engineer.
- `ai-transcript.md` — exported AI conversation transcript(s) from the build sessions.
