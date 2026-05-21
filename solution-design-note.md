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
