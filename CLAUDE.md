# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **completed** take-home technical assessment (Solutions Engineering), built in TypeScript.
The service reads Meridian Earn strategy/asset data from local JSON files in `data/` and exposes
one endpoint for the fictional "Aurora Bank":

`GET /earn-products?tier={standard|premium|private}` — optional `?locale=` (BCP 47 tag,
default `en-US`) localises `apyDisplay`. Returns a JSON array of earn products, filtered by
Aurora's business rules and sorted by APY descending.

The four submission deliverables are the service code, `README.md`, `ai-transcript.md`, and
`solution-design-note.md`; `docs/` and `scripts/` are process artefacts, not deliverables.

## Commands

```bash
npm test            # vitest — full suite (unit + endpoint)
npm run test:watch  # vitest watch mode
npm run build       # tsc → dist/
npm run dev         # tsx watch — local server on :3000, reads ./data
npm run lint        # eslint
npm run format      # prettier --write
docker-compose up   # build + run on http://localhost:3000  (v2: docker compose up)
```

## Architecture

Three layers, business logic isolated from I/O:

- `src/meridian/` — `MeridianEarnClient` interface over the two Meridian endpoints.
  `FileMockMeridianClient` (`mock-client.ts`) reads `data/`; a real `HttpMeridianClient` would be
  the only addition for a live integration. Zod schemas in `schema.ts`.
- `src/domain/` — pure functions, no I/O: APR→APY (`apy.ts`), tier model (`tiers.ts`),
  filter/transform, orchestration (`earn-products.ts`).
- `src/routes/`, `src/app.ts`, `src/server.ts` — thin Express layer with a backstop
  error-handler so every failure returns a structured error.

## Hard constraints (the submission satisfies these — do not regress them)

- `docker-compose up` from the repo root must work with **no other steps** — no env vars,
  credentials, or manual config.
- `docker-compose.yml` must **not** declare a custom `networks:` block — default compose
  network only.
- Runtime network is closed: the service makes **no outbound calls at runtime**; all data
  comes from the mounted `data/` directory. (Build-time network is open.)
- Read **every** `.json` file in `data/` by globbing — graders add files during scoring.
  Do not hardcode `strategies.json` / `assets.json`.
- On unavailable or malformed data, return a **structured error object** — never a raw stack
  trace or unhandled exception.
- The output array must be sorted by **APY descending**.

## Business rules

- **APY filter:** drop any strategy with APY < 3%. Hard filter, never relaxed.
- **Tier eligibility:** Standard sees only instant-access strategies; Premium and Private see
  all qualifying strategies. Bonded/locked strategies are Premium/Private only.

## Data model gotchas

Both files use Meridian's envelope `{ "error": [], "result": ... }`. Strategies live under
`result.items` (array); assets under `result` (object keyed by internal asset code).

- A strategy's `asset` is Meridian's internal code (`XETH`); the customer-facing name is the
  `altname` in `assets.json` (note `POL`'s altname is `MATIC` — not interchangeable).
- No `apy` field — strategies carry `apr_estimate.low`/`.high` as **strings**. The service
  takes `.low` and converts APR→APY.
- `lock_type.type` ∈ {`instant`, `bonded`, `flex`, `hybrid`, `timed`}. `flex` (Meridian
  Rewards) is **excluded from the catalog entirely**; `instant` is all-tier; `bonded`/
  `hybrid`/`timed` carry a withdrawal lock and are Premium/Private only.
- All rate maths uses exact decimals (`big.js`), never float — so a near-boundary APR like
  `2.9999999999999999` is read as correctly below the 3% threshold.
- The mock data has deliberate edge cases (missing `apr_estimate`, sub-threshold APYs,
  boundary values). The rationale for every judgment call lives in the code comments and
  `solution-design-note.md` — read those before changing the filter/tier/APY logic.

## Required output shape

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

`minimumAmount` stays a **string** (precision); `apyValue` is numeric, `apyDisplay` localised.
`displayName` is synthesised — no Meridian endpoint exposes a product name.

## Reference

The mock files represent the responses of Meridian's Earn Strategies API — its
`List Strategies` REST endpoint. The service mocks these calls and reads the local `data/`
JSON files instead of calling the API at runtime.
