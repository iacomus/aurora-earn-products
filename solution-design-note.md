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
   conservative `low` and convert with the standard formula `APY = (1 + APR/n)^n - 1`. Here
   `n` is the **count of payout events in a year** — necessarily a whole number, because a
   payout either happens in a given period or it does not. Weekly payouts give `n = 52`, not
   the calendar ratio `365 ÷ 7 ≈ 52.14`: the service derives `n` from the strategy's payout
   frequency and rounds to the nearest integer (`Math.round`). This matches Meridian's own
   definition — its docs describe `n` as the "number of funding periods per year based on
   your weekly payouts", likewise an integer. We only compound when the strategy actually
   auto-compounds; otherwise APY = APR. All of this runs in exact decimal — see "Known edge
   cases".
3. **Apply the filters** (a strategy must pass all of them):
   - The lock type is **not `flex`** — `flex` is Meridian Rewards, an account-wide passive
     yield rather than a pickable product (see "Known edge cases").
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

`flex` strategies never reach this step — they are excluded from the catalog upstream
(see "Known edge cases" below).

## Known edge cases (already handled)

- A strategy with **no reward-rate data** is dropped (cannot show an APY we don't have).
- **All APY arithmetic is exact decimal**, not IEEE-754 float — the APR→APY
  conversion, the ≥ 3% threshold, and the APY sort order all run on `big.js`
  decimals; float appears only at the JSON boundary, where `apyValue` is a
  number. `POL`'s `apr_estimate.low` is the string `2.9999999999999999`: it
  *parses* to the double `3.0`, but its true decimal value is below 3, so **POL
  is excluded**. POL's APR range (`low` just under 3, `high` just over 3)
  straddles the threshold, so the rate sits below 3% for roughly half its
  fluctuation band — a conservative compliance posture (EU MiCA, UK FCA) treats
  such a product as sub-threshold rather than advertising it as "≥ 3%".
- **`flex` strategies are excluded from the catalog.** Meridian's `flex` ("Meridian Rewards") is
  an account-wide passive yield, not a per-strategy allocation a customer can pick — it is
  not a catalog product, so `flex` strategies are dropped for every tier. (Some `flex`
  records in the data carry `can_allocate: true`, which contradicts Meridian's model; the
  exclusion keys off the lock type, not that flag.) `hybrid`, `timed`, and any unknown
  future lock type are classified by lock structure and default to "locked"
  (Premium/Private only).
- A strategy referencing an **unknown asset code**, a file with **malformed JSON**, or a
  Meridian response carrying an **error** all produce a structured error, not a crash.
- **The data loader fails closed.** The service reads every `.json` file in `data/` and
  classifies each by its Meridian envelope shape. It requires both a strategies capture and
  an assets capture — if either is absent it returns a structured `DATA_UNAVAILABLE`
  error, never an empty `200`, so a missing dataset is not mistaken for "no products
  available". An envelope-shaped file that fails schema validation raises `DATA_MALFORMED`
  instead of being silently skipped; only files with no envelope shape are ignored as
  unrelated. An *empty* but present capture (e.g. zero strategies) is still valid and
  yields a legitimate empty result.

## Suggested next steps toward production

- **Real API client.** Implement `MeridianEarnClient` over HTTPS with API-key auth, timeouts,
  retries, and pagination handling.
- **Caching & refresh.** Reward rates change; cache responses with a sensible TTL or a
  scheduled refresh rather than reading once at startup, and de-duplicate concurrent loads
  (the PoC's first-load cache can read the source more than once under a simultaneous burst).
- **Per-customer geography.** Meridian filters strategies by *Aurora's account* region. If
  Aurora's customers span jurisdictions with different rules, pass the customer's country to
  the endpoint and filter against Aurora's own per-jurisdiction permissions.
- **Surface Meridian Rewards (`flex`) separately.** `flex` strategies are excluded from
  `/earn-products`. Aurora may still want to show these yields to customers — but as passive
  yield inline with a wallet balance, not as a selectable item in the earn catalog. That is
  a separate feature with its own endpoint and UX.
- **Localised display.** `apyDisplay` currently uses a fixed `4.25%` format; format per the
  customer's locale.
- **HTTP surface.** The PoC exposes a single route; an unknown path falls through to
  Express's default `404`. Add a JSON `404` response and a catch-all error-handler middleware.
- **Hardening.** Add authentication, rate limiting, request logging, and metrics.
