# Solution Design Note — Earn Products Service

**Audience:** Aurora Bank backend engineering.
**Purpose:** hand off the proof-of-concept that exposes Meridian crypto earn products to
Aurora's customers, so your team can take it toward production.

## What was built

A small HTTP service with one endpoint:

```
GET /earn-products?tier={standard|premium|private}
```

It returns a JSON array of earn products — each with a display name, APY, lock type,
eligible customer tiers, and minimum amount — sorted by APY (highest first), ready for the
mobile app. Invalid input or bad source data returns a structured error object, never a
stack trace.

## Where the data comes from

Two Meridian Earn API calls, modelled behind one interface (`MeridianEarnClient`):

| Call | Purpose |
|---|---|
| `POST /private/Earn/Strategies` | The earn strategies — asset, lock type, reward rate, minimum amount. Authenticated; the response is scoped to *your* Meridian account. |
| `GET /public/Assets` | Asset metadata — used to turn Meridian's internal codes (`XETH`) into customer-facing names (`ETH`). |

The PoC ships a **mock** of these calls that reads saved responses from a `data/` folder.
To go live, implement `MeridianEarnClient` with a real HTTP client — **nothing else in the
service changes.**

## How a strategy becomes a product

1. **Resolve the asset name.** Meridian's `XETH` → `ETH` via the Assets data. (Watch out:
   `POL`'s display name is `MATIC` — codes and names are not interchangeable.)
2. **Work out the APY.** Meridian gives an *APR range* (`low`/`high`), not an APY. We take the
   conservative `low` and convert: `APY = (1 + APR/n)^n - 1`, where `n` is the number of
   compounding periods per year. We only compound when the strategy actually auto-compounds.
3. **Apply the filters** (a strategy must pass all of them):
   - APY is at least **3%** (Aurora compliance rule).
   - `can_allocate` is not `false` (your account can actually invest in it).
   - The asset is `enabled` on Meridian (not delisted/suspended).
4. **Decide tier visibility** (see below) and format the output.

## How the tier logic works

Aurora has three customer tiers. Visibility depends on whether a strategy is
**instant-access** (the customer can withdraw any time) or **locked**:

- **Standard** customers see **instant-access** strategies only.
- **Premium** and **Private** customers see **all** qualifying strategies.

A strategy is *locked* if it has an unbonding period, an exit queue, delayed withdrawals, or
a fixed term — otherwise it is instant-access. This is decided from the data's structure,
not just the lock-type label, so new Meridian lock types are handled safely.

## Known edge cases (already handled)

- A strategy with **no reward-rate data** is dropped (cannot show an APY we don't have).
- The **≥ 3% threshold is evaluated in exact decimal**, not in IEEE-754 floats.
  `POL`'s `apr_estimate.low` is the string `2.9999999999999999`: it *parses* to
  the double `3.0`, but its true decimal value is below 3, so **POL is excluded**.
  POL's APR range (`low` just under 3, `high` just over 3) straddles the
  threshold, so the rate sits below 3% for roughly half its fluctuation band — a
  conservative compliance posture (EU MiCA, UK FCA) treats such a product as
  sub-threshold rather than advertising it as "≥ 3%". The comparison uses the
  `big.js` decimal library; a production Meridian API returning numeric values
  directly would remove this string-parsing ambiguity entirely.
- Lock types beyond the documented `instant`/`bonded` (`flex`, `hybrid`, `timed`) are
  classified by their lock structure; unknown future types default to "locked".
- A strategy referencing an **unknown asset code**, a file with **malformed JSON**, or a
  Meridian response carrying an **error** all produce a structured error, not a crash.

## Suggested next steps toward production

- **Real API client.** Implement `MeridianEarnClient` over HTTPS with API-key auth, timeouts,
  retries, and pagination handling.
- **Caching & refresh.** Reward rates change; cache responses with a sensible TTL or a
  scheduled refresh rather than reading once at startup, and de-duplicate concurrent loads
  (the PoC's first-load cache can read the source more than once under a simultaneous burst).
- **Per-customer geography.** Meridian filters strategies by *Aurora's account* region. If
  Aurora's customers span jurisdictions with different rules, pass the customer's country to
  the endpoint and filter against Aurora's own per-jurisdiction permissions.
- **`flex` products.** Meridian's `flex` ("Meridian Rewards") is an account-wide setting, not a
  per-strategy allocation — the app should present it differently from a normal product.
- **Localised display.** `apyDisplay` currently uses a fixed `4.25%` format; format per the
  customer's locale.
- **HTTP surface.** The PoC exposes a single route; an unknown path falls through to
  Express's default `404`. Add a JSON `404` response and a catch-all error-handler middleware.
- **Hardening.** Add authentication, rate limiting, request logging, and metrics.
