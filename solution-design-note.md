# Solution Design Note — Earn Products Service

**Audience:** Aurora Bank backend engineering.
**Purpose:** hand off the proof-of-concept that surfaces Meridian crypto earn products to
Aurora's customers, so your team can take it to production.

## What was built

A small HTTP service with one endpoint, `GET /earn-products?tier={standard|premium|private}`.
It returns a JSON array of earn products — each with a display name, APY, lock type,
eligible customer tiers, and minimum amount — sorted by APY, highest first, ready for the
mobile app. An optional `locale` query parameter (a BCP 47 tag, default `en-US`) localises
the `apyDisplay` string. Invalid input or bad source data returns a structured error
object — `{ "error": { "code": ..., "message": ... } }`, with HTTP 400 for bad input and
5xx for data problems — never a stack trace or a partial result.

## Where the data comes from

Two Meridian Earn API calls, modelled behind one interface (`MeridianEarnClient`):

| Call | Purpose |
|---|---|
| `POST /private/Earn/Strategies` | The earn strategies — asset, lock type, reward rate, minimum amount. Authenticated; the response is scoped to *your* Meridian account. |
| `GET /public/Assets` | Asset metadata — turns Meridian's internal codes (`XETH`) into customer-facing names (`ETH`). |

The PoC ships a **mock** implementation (`FileMockMeridianClient`) that reads saved
responses from a local `data/` folder — a working reference to mirror. To go live, add a
second implementation of the same interface backed by a real HTTP client; nothing else in
the service changes.

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
4. **Decide tier visibility.** Which customer tiers may see the strategy — see *How the
   tier logic works* below. This populates `eligibleTiers`.
5. **Format the output.** The APY is emitted twice — `apyValue` as a raw number for the
   app to compute with, and `apyDisplay` as a locale-formatted string for direct rendering
   (which is what the `locale` parameter controls). `minimumAmount` is passed through as a
   string, not a number: it is a crypto quantity, and parsing it to a float would lose
   precision.

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
- **Exact-decimal threshold.** The ≥3% test runs on exact decimals, not floating-point, so
  an APR string sitting microscopically below 3% (e.g. `2.9999999999999999`) is read as
  correctly below the threshold rather than rounded up across it.
- **Bad data fails loudly.** Malformed JSON, a missing dataset, an unknown asset code, or
  an error reported in the captured response all produce a structured error — never a
  partial or empty success that hides the problem.

## Suggested next steps toward production

- **Real API client.** Replace the mock with an `HttpMeridianClient` implementing the same
  interface. `GET /public/Assets` is public; `POST /private/Earn/Strategies` is
  authenticated — each request needs an `API-Key` header and an `API-Sign` HMAC header
  computed over an ever-increasing `nonce`. Add request timeouts and retry-with-backoff,
  respect Meridian's per-key rate limits, page the strategies response if needed, and map
  Meridian's `error` array onto the service's structured-error model. Nothing else in the
  service changes.
- **Caching & refresh.** The PoC reads the data once, on the first request, and holds it
  for the process lifetime. Meridian's APRs are estimates — trailing averages of past
  rewards — and the catalog (strategies, caps, restrictions) shifts too, so production
  must refresh. Meridian exposes no push or webhook for rate changes, so that refresh is a
  poll — `POST /private/Earn/Strategies` re-fetched on a schedule. Meridian documents no
  fixed update cadence; but because the rates drift gradually rather than jump, an hourly
  refresh or a short TTL is ample — tighter invalidation adds no customer-visible accuracy.
- **Product display names.** No Meridian endpoint exposes a product or full asset name —
  only the ticker `altname`. The service synthesises `displayName` from the asset and lock
  type, which is what Meridian's own apps do. For production, Aurora should decide
  deliberately: keep synthesising and own the naming convention, or maintain its own
  product-name catalog.
- **Per-customer geography.** Meridian's List Strategies endpoint returns only strategies
  available in *Aurora's account* region — that set is a ceiling, so the service can never
  surface a product Meridian withheld from Aurora's account. Supporting customers in other
  jurisdictions would mean taking the customer's country as an input to `/earn-products`
  and *further* narrowing the list against Aurora's own per-jurisdiction rules.
- **Hardening.** Add authentication, rate limiting, request logging, and metrics.

## References

- [Meridian Earn — List Strategies](https://docs.meridian.com/api/docs/rest-api/list-strategies/) — primary data source (`POST /private/Earn/Strategies`).
- [Meridian — Get Asset Info](https://docs.meridian.com/api/docs/rest-api/get-asset-info/) — the `GET /public/Assets` endpoint.
- [Spot REST Authentication](https://docs.meridian.com/api/docs/guides/spot-rest-auth/) — `API-Key` / `API-Sign` request signing for private endpoints.
- [Spot REST Rate Limits](https://docs.meridian.com/api/docs/guides/spot-rest-ratelimits/) — the counter model to design backoff against.
