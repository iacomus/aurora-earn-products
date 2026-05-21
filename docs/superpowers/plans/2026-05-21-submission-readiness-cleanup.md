# Submission-Readiness Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the assessment repository submission-ready — trim the solution design note to one page, fix one stale internal doc, and verify the hard constraints all pass.

**Architecture:** Documentation-only changes plus a verification pass. No service code is modified. The service code, README, and design-note content were audited as accurate against the shipped code (`mock-client.ts`, `app.ts`, `earn-products.ts`); see `docs/superpowers/specs/2026-05-21-submission-readiness-cleanup-design.md`.

**Tech Stack:** Markdown, npm/vitest, Docker Compose.

---

## File Structure

- **Modify (full rewrite):** `solution-design-note.md` — trimmed to ~one page.
- **Modify (one line):** `docs/superpowers/specs/2026-05-20-aurora-earn-products-service-design.md` — fix the §13 caching claim.
- **Read-only check:** `README.md` — consistency pass against the rewritten note.
- **No change:** `docs/superpowers/plans/2026-05-20-aurora-earn-products-service.md` — already states "cached" correctly (lines 476, 1797); verified, no edit needed.

---

## Task 1: Rewrite `solution-design-note.md` to one page

**Files:**
- Modify: `solution-design-note.md` (full rewrite — replace entire file)

- [ ] **Step 1: Replace the file with the trimmed one-page version**

Write `solution-design-note.md` with exactly this content:

```markdown
# Solution Design Note — Earn Products Service

**Audience:** Aurora Bank backend engineering.
**Purpose:** hand off the proof-of-concept that surfaces Meridian crypto earn products to
Aurora's customers, so your team can take it to production.

## What was built

A small HTTP service with one endpoint, `GET /earn-products?tier={standard|premium|private}`.
It returns a JSON array of earn products — each with a display name, APY, lock type,
eligible customer tiers, and minimum amount — sorted by APY, highest first, ready for the
mobile app. Invalid input or bad source data returns a structured error object, never a
stack trace.

## Where the data comes from

Two Meridian Earn API calls, modelled behind one interface (`MeridianEarnClient`):

| Call | Purpose |
|---|---|
| `POST /private/Earn/Strategies` | The earn strategies — asset, lock type, reward rate, minimum amount. Authenticated; the response is scoped to *your* Meridian account. |
| `GET /public/Assets` | Asset metadata — turns Meridian's internal codes (`XETH`) into customer-facing names (`ETH`). |

The PoC ships a **mock** of these calls that reads saved responses from a local `data/`
folder. To go live, implement `MeridianEarnClient` with a real HTTP client — nothing else
in the service changes.

## How a strategy becomes a product

1. **Resolve the asset name.** Meridian's internal code (`XETH`) → display name (`ETH`) via
   the Assets data. (`POL`'s display name is `MATIC` — codes and names are not
   interchangeable.)
2. **Compute the APY.** Meridian gives an APR *range*, not an APY. We take the conservative
   low end and convert APR → APY, compounding only when the strategy auto-compounds. All
   rate maths uses exact decimals, not floating point, so the compliance threshold is
   never crossed by a rounding artefact.
3. **Apply the filters.** A strategy is kept only if: its APY is at least 3% (Aurora
   compliance rule); your account can allocate to it; its asset is active on Meridian; and
   it is not a `flex` strategy (see edge cases).
4. **Decide tier visibility** (below) and format the output.

## How the tier logic works

Aurora has three customer tiers. Visibility depends on whether a strategy is
**instant-access** (withdraw any time) or **locked**:

- **Standard** customers see instant-access strategies only.
- **Premium** and **Private** customers see all qualifying strategies.

A strategy counts as locked if it has an unbonding period, an exit queue, delayed
withdrawals, or a fixed term. This is read from the data's structure, not just a label,
so new Meridian lock types are handled safely — anything carrying a lock defaults to
Premium/Private.

## Known edge cases (already handled)

- A strategy with **no reward-rate data** is dropped — we cannot show an APY we do not
  have.
- **`flex` strategies are excluded entirely.** Meridian's `flex` ("Meridian Rewards") is an
  account-wide passive yield, not a product a customer picks — so it never appears in the
  catalog, for any tier.
- **Threshold edge.** One asset (POL) has an APR that sits just below 3% as an exact
  decimal even though it rounds to 3.0 as a floating-point number. Exact-decimal maths
  keeps it correctly excluded — a conservative compliance posture.
- **Bad data fails loudly.** Malformed JSON, a missing dataset, an unknown asset code, or
  an error reported in the captured response all produce a structured error — never a
  partial or empty success that hides the problem.

## Suggested next steps toward production

- **Real API client.** Implement `MeridianEarnClient` over HTTPS with API-key auth,
  timeouts, retries, and pagination.
- **Caching & refresh.** Reward rates change; the PoC reads the data once at startup. Add
  a sensible TTL or a scheduled refresh.
- **Per-customer geography.** Meridian filters strategies by *Aurora's account* region. If
  Aurora's customers span jurisdictions, pass the customer's country to the endpoint and
  filter against Aurora's own per-jurisdiction permissions.
- **Localised display.** `apyDisplay` currently uses a fixed `4.25%` format; format per
  the customer's locale.
- **Hardening.** Add authentication, rate limiting, request logging, and metrics.
```

- [ ] **Step 2: Verify the file is one page**

Run: `wc -l solution-design-note.md`
Expected: roughly 65–75 lines (one printed page). If substantially longer, the wrong content was written.

- [ ] **Step 3: Verify brief coverage**

Confirm by reading the file that all five brief-required items are present: what was built, key API calls and their purpose, how the tier logic works, known edge cases, suggested next steps. All five headings exist in the content above — this is a read-through sanity check.

- [ ] **Step 4: Commit**

```bash
git add solution-design-note.md
git commit -m "docs: trim solution design note to one page"
```

---

## Task 2: Fix the stale caching claim in the internal spec

**Files:**
- Modify: `docs/superpowers/specs/2026-05-20-aurora-earn-products-service-design.md:524-525`

The spec's §13 claims data is "read fresh from disk per request". The shipped
`FileMockMeridianClient` caches the loaded result for the process lifetime, and it lists
"caching" as out-of-scope when caching is in fact implemented. Both errors are fixed in
one edit.

- [ ] **Step 1: Apply the edit**

Find this exact text in `docs/superpowers/specs/2026-05-20-aurora-earn-products-service-design.md`:

```
- **No auth, rate limiting, caching, or observability** — out of scope for a PoC; data is
  read fresh from disk per request.
```

Replace it with:

```
- **No auth, rate limiting, or observability** — out of scope for a PoC. Data is read
  once and cached for the process lifetime; a production cache would add a TTL or a
  scheduled refresh.
```

- [ ] **Step 2: Verify no other stale caching claim remains**

Run: `grep -n -i "fresh\|per request" docs/superpowers/specs/2026-05-20-aurora-earn-products-service-design.md`
Expected: no output (the only match was the line just fixed).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-05-20-aurora-earn-products-service-design.md
git commit -m "docs: correct stale caching claim in design spec"
```

---

## Task 3: README consistency pass against the rewritten note

**Files:**
- Read-only check: `README.md`

The README is intentionally kept as the detailed reference. This task only confirms it
does not contradict the trimmed `solution-design-note.md`.

- [ ] **Step 1: Read both documents side by side**

Read `README.md` and `solution-design-note.md`. Check these specific claims agree across both:
- APY is taken from the conservative low end of the APR range.
- `flex` strategies are excluded from the catalog entirely.
- Data is read once and cached for the process lifetime.
- The error model returns a structured error object, never a stack trace.
- Tiers: Standard sees instant-access only; Premium/Private see all qualifying strategies.

- [ ] **Step 2: Resolve any contradiction**

Expected outcome: no contradiction (the README already states all five consistently). If a contradiction is found, edit `README.md` to match the shipped behaviour and the design note, then commit with `git commit -m "docs: align README with trimmed design note"`. If none is found, no commit is needed — record "no change required" and move on.

---

## Task 4: Verify the hard constraints

**Files:**
- None modified — this is a verification task.

The brief's hardest rule: the submission is not evaluated if `docker-compose up` does not
work from a clean checkout.

- [ ] **Step 1: Run the test suite**

Run: `npm test`
Expected: all vitest suites pass, exit code 0.

- [ ] **Step 2: Build and start the service via Docker Compose**

Run: `docker compose up --build -d`
Expected: the `earn-products` service builds and starts; no error output.

- [ ] **Step 3: Exercise the three tiers**

Run each and confirm a JSON array sorted by `apyValue` descending:

```bash
curl -s 'http://localhost:3000/earn-products?tier=standard'
curl -s 'http://localhost:3000/earn-products?tier=premium'
curl -s 'http://localhost:3000/earn-products?tier=private'
```

Expected: each returns a JSON array; `premium` and `private` are identical and include
locked strategies; `standard` is a subset (instant-access only). APY descending in each.

- [ ] **Step 4: Exercise the error paths**

```bash
curl -s 'http://localhost:3000/earn-products?tier=gold'
curl -s 'http://localhost:3000/earn-products'
curl -s 'http://localhost:3000/nonexistent'
```

Expected: each returns a structured error object of shape `{ "error": { "code": "...", "message": "..." } }` — `INVALID_TIER` for the first two, `NOT_FOUND` for the third. No stack traces.

- [ ] **Step 5: Stop the service**

Run: `docker compose down`
Expected: the container stops and is removed cleanly.

- [ ] **Step 6: Report results**

Summarise: tests pass/fail, Docker build pass/fail, the three tiers and three error paths behaving as expected. If anything failed, stop and report it — a failure here is a submission blocker and needs a fix decision before proceeding.

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-05-21-submission-readiness-cleanup-design.md`):
- Scope item 1 (rewrite design note to one page) → Task 1. ✓
- Scope item 2 (fix stale internal spec; scan plan doc) → Task 2; plan doc verified clean during planning (no task needed). ✓
- Scope item 3 (README consistency pass) → Task 3. ✓
- Scope item 4 (verify hard constraints) → Task 4. ✓

**Placeholder scan:** No TBD/TODO. Task 1 embeds the full file content; Task 2 shows exact old/new text; Task 4 shows exact commands and expected output. ✓

**Type consistency:** No code types. Error-shape `{ "error": { "code", "message" } }` in Task 4 matches the error model in the README and design note. ✓
