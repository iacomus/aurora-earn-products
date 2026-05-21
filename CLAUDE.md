# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

This is a **take-home technical assessment**, not an existing application. The repo currently
holds only the brief (`ASSESSMENT.md`), a `README.md`, and mock data under `data/`. No service
code, `Dockerfile`, or `docker-compose.yml` exists yet — building them is the task. Read
`ASSESSMENT.md` in full before writing code; it is the source of truth for requirements and
scoring. Language is the implementer's choice: TypeScript **or** Rust.

## What must be built

A small HTTP service that:
- Reads earn-strategy and asset data from local JSON files in `data/`.
- Exposes `GET /earn-products?tier={tier}` (`tier` ∈ `standard`, `premium`, `private`).
- Returns a JSON array of strategies filtered/formatted for the fictional "Aurora Bank",
  sorted by APY descending.
- Ships with a root `Dockerfile` + `docker-compose.yml` so `docker-compose up` alone starts
  it on `http://localhost:3000`.

## Hard constraints (violating any of these rejects the submission)

- `docker-compose up` from the repo root must work with **no other steps** — no env vars,
  no credentials, no manual config.
- `docker-compose.yml` must **not** declare a custom `networks:` block — only the default
  compose network is allowed.
- Build-time network is open (dependency installs are fine); **runtime network is closed** —
  the service must never make outbound calls at runtime. All data comes from the mounted
  `data/` directory.
- Read **every** `.json` file in `data/` by globbing the directory — graders add more files
  during scoring. Do not hardcode `strategies.json` / `assets.json`.
- On unavailable or malformed data, return a **structured error object** — never a raw stack
  trace or unhandled exception.
- The output array must be sorted by **APY descending**.

## Data model & non-obvious gotchas

Both files use Meridian's response envelope: `{ "error": [], "result": ... }`.
- `strategies.json` → strategies live under `result.items` (array).
- `assets.json` → assets are a **keyed object** under `result`, keyed by internal asset code.

Mapping a strategy to the required output shape needs care:

- **Asset codes vs. display names.** A strategy's `asset` is Meridian's internal code
  (`XETH`, `XADA`, `XXTZ`). The customer-facing name is the `altname` in `assets.json`.
  Note `POL`'s altname is `MATIC` — codes and altnames are not interchangeable.
- **No single APY field.** Strategies carry `apr_estimate.low` / `apr_estimate.high` as
  **strings** (e.g. `"4.0000"`); there is no `apy` field. Which value represents "the APY"
  (low / high / midpoint) is a judgment call to make and document. `apyValue` is numeric,
  `apyDisplay` is a localised string like `"4.25%"`.
- **`lock_type.type` has five values in the data:** `instant`, `bonded`, `flex`, `hybrid`,
  `timed`. The brief's tier rules only name `instant` (Standard-eligible) and `bonded` with
  an unbonding period (Premium/Private only). Deciding how `flex`, `hybrid`, and `timed`
  map onto the tier model — and whether `flex` counts as instant-access for Standard — is
  the central business-logic judgment call. Make it deliberately and document the reasoning.
- **Deliberate edge cases in the mock data:**
  - `MINA` has **no `apr_estimate` field at all** — handle the missing-APY case.
  - `ALGO` APY is `0.0000`; `AVAX` is `0.5–1.5` — both below the 3% threshold.
  - `POL` APY strings are `2.9999999999999999` / `3.0000000000000001`. Both parse to the
    IEEE-754 double `3.0`, but as **exact decimals** they straddle the threshold — `low` is
    below 3, `high` is above. The service compares the APR in exact decimal (`big.js`), not
    as a float: the `≥ 3%` filter is inclusive of an exact `3.0`, but `POL` (filtered on
    `apr_estimate.low`) is below 3 and is **excluded**.
  - `XXTZ` (`flex`) is `2.5–3.5` — straddles the threshold depending on which apr value
    you pick.
- `user_min_allocation` is a string → output `minimumAmount` (keep as string).
  Strategy `id` (e.g. `ESDQCOL-WTZEU-NU55QF`) → output `strategyId`.

## Business rules (from ASSESSMENT.md)

- **APY filter:** drop any strategy with APY < 3%. Hard filter — never relaxed.
- **Tier eligibility:** Standard customers see only instant-access strategies; Premium and
  Private see all qualifying strategies. Bonded strategies with an unbonding period are
  restricted to Premium/Private.

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

## Running (once built)

- `docker-compose up` — builds and starts the service on `http://localhost:3000`.
- `curl 'http://localhost:3000/earn-products?tier=premium'` — exercise the endpoint.

## Deliverables checklist (ASSESSMENT.md — Submission Package)

- Service code (TypeScript or Rust) + root `Dockerfile` + `docker-compose.yml`.
- `README.md` — architecture decisions, key dependencies each with a safety note, known
  limitations.
- `ai-transcript.md` — full AI conversation transcript(s) from every tool/session used.
- `solution-design-note.md` — one-page handoff for a mid-level Aurora Bank backend engineer
  (external audience: no internal jargon, no assumed context).

## Reference

- Meridian Earn Strategies API: <https://docs.meridian.com/api/docs/rest-api/list-strategies> —
  reference for what the mock files represent. The service mocks these calls and reads the
  local `data/` JSON files instead of calling the API.
