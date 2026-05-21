# Submission-Readiness Cleanup — Design

- **Date:** 2026-05-21
- **Status:** Approved — ready for implementation
- **Context:** Solutions Engineering take-home assessment (`ASSESSMENT.md`). The service
  code, `README.md`, and `solution-design-note.md` are substantially complete. This is a
  documentation and verification pass to make the repository submission-ready.

## Problem

An audit of the repo against the brief's Submission Package found four issues standing
between the current state and a clean submission. The service code itself is sound — the
README and `solution-design-note.md` were verified accurate against `mock-client.ts`,
`app.ts`, and `earn-products.ts`. No code changes are in scope.

## Scope — four changes

### 1. Rewrite `solution-design-note.md` to ~one page

The brief asks for a **one-page** Solution Design Note and stresses it is the artifact
that "matters a lot". The current note is ~3–4 pages. It over-explains for a handoff
document aimed at a mid-level backend engineer.

Target: ~55–65 lines / one printed page. Structure:

- Header — audience + purpose (2 lines)
- *What was built* — 3 sentences
- *Where the data comes from* — the two Meridian calls as a small table, plus one line on
  the mock → production swap
- *How a strategy becomes a product* — 5 numbered steps, one line each
- *How tier logic works* — 3 bullets
- *Known edge cases* — 4–5 tight bullets
- *Next steps to production* — 5 bullets

Relocated, not lost — the following move out of the note into the README's "Key
decisions" section and the code comments, where they already partly live:

- the worked example (the 14-strategy table)
- the APR → APY formula derivation
- the `big.js`-vs-`decimal.js` and IEEE-754 / POL deep-dive
- the MiCA / FCA regulatory tangents

Jargon is softened for the external audience: "structured error" rather than
"fail-closed", "Meridian's response wrapper" rather than "envelope".

The note must still cover everything the brief names: what was built, key API calls and
their purpose, how the tier logic works, known edge cases, suggested next steps.

### 2. Fix the stale internal spec

`docs/superpowers/specs/2026-05-20-aurora-earn-products-service-design.md` §13 states
*"data is read fresh from disk per request"*. This contradicts the shipped code
(`FileMockMeridianClient` caches the loaded result for the client's lifetime) and both
submission docs. Correct the line to match the read-once-and-cache behaviour, using the
wording the README and design note already use.

Also scan `docs/superpowers/plans/2026-05-20-aurora-earn-products-service.md` for the
same staleness and correct any found.

### 3. README — keep as the detailed reference

Once the design note is slimmed, the README becomes the canonical home for the deeper
reasoning. No trim. A consistency pass only, to ensure nothing in the README contradicts
the rewritten design note.

### 4. Verify the hard constraints

The brief's hardest constraint: the submission is not evaluated if `docker-compose up`
does not work out of the box. Verify before submission:

- `npm test` passes.
- `docker compose up` builds and starts the service on `http://localhost:3000`.
- `curl` against all three tiers (`standard`, `premium`, `private`) returns a JSON array
  sorted by APY descending.
- An invalid tier and an unknown route both return the structured error shape.

Fix anything that fails.

## Out of scope

- `ai-transcript.md` — the user is compiling this separately.
- Service code changes — the code is sound; the audit found no defects in it.
- `CLAUDE.md` — kept as-is (decision: keep process/AI artifacts in the repo).
- README trim — kept as the detailed reference by design.

## Success criteria

- `solution-design-note.md` is ~one page and still covers every item the brief names.
- No file tracked in git contradicts the shipped code.
- `docker compose up` serves the three tiers correctly from a clean checkout.
