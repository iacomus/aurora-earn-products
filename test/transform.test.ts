// test/transform.test.ts
import { describe, it, expect } from "vitest";
import { toProduct, displayName } from "../src/domain/transform";
import type { RawStrategy, AssetMap } from "../src/meridian/schema";

const assets: AssetMap = {
  XETH: { altname: "ETH", status: "enabled" },
  SOL: { altname: "SOL", status: "enabled" },
  POL: { altname: "MATIC", status: "enabled" },
  DEAD: { altname: "DEAD", status: "disabled" },
};

const strat = (
  over: Partial<RawStrategy> & Pick<RawStrategy, "id" | "asset">,
): RawStrategy => ({
  lock_type: { type: "instant", payout_frequency: 604800 },
  apr_estimate: { low: "8.0000" },
  user_min_allocation: "0.01",
  auto_compound: { type: "disabled" },
  can_allocate: true,
  ...over,
});

describe("displayName", () => {
  it("synthesises {altname} {lock} {yield}", () => {
    expect(
      displayName(
        strat({
          id: "S",
          asset: "XETH",
          lock_type: { type: "bonded" },
          yield_source: { type: "staking" },
        }),
        "ETH",
      ),
    ).toBe("ETH Bonded Staking");
    expect(
      displayName(
        strat({
          id: "S",
          asset: "USDC",
          lock_type: { type: "hybrid" },
          yield_source: { type: "defi" },
        }),
        "USDC",
      ),
    ).toBe("USDC DeFi Vault");
    expect(
      displayName(
        strat({
          id: "S",
          asset: "POL",
          lock_type: { type: "flex" },
          yield_source: { type: "staking" },
        }),
        "MATIC",
      ),
    ).toBe("MATIC Flexible Staking");
  });
});

describe("toProduct", () => {
  it("builds an EarnProduct for a qualifying strategy", () => {
    const p = toProduct(
      strat({ id: "S1", asset: "XETH", yield_source: { type: "staking" } }),
      assets,
    );
    expect(p).toEqual({
      strategyId: "S1",
      asset: "ETH",
      displayName: "ETH Flexible Staking",
      lockType: "instant",
      apyDisplay: "8.00%",
      apyValue: 8,
      eligibleTiers: ["Standard", "Premium", "Private"],
      minimumAmount: "0.01",
    });
  });

  it("resolves the asset altname (POL → MATIC)", () => {
    expect(toProduct(strat({ id: "S", asset: "POL" }), assets)?.asset).toBe(
      "MATIC",
    );
  });

  it("throws DATA_MALFORMED for an unknown asset code", () => {
    expect(() =>
      toProduct(strat({ id: "S", asset: "NOPE" }), assets),
    ).toThrowError(/unknown asset code/);
  });

  it("drops a strategy with can_allocate:false", () => {
    expect(
      toProduct(strat({ id: "S", asset: "XETH", can_allocate: false }), assets),
    ).toBeNull();
  });

  it("drops a strategy whose asset is not enabled", () => {
    expect(toProduct(strat({ id: "S", asset: "DEAD" }), assets)).toBeNull();
  });

  it("drops a strategy with APY below 3%", () => {
    expect(
      toProduct(
        strat({ id: "S", asset: "XETH", apr_estimate: { low: "2.5000" } }),
        assets,
      ),
    ).toBeNull();
  });

  it("drops a strategy with no apr_estimate", () => {
    const { apr_estimate, ...noApr } = strat({ id: "S", asset: "XETH" });
    expect(toProduct(noApr as RawStrategy, assets)).toBeNull();
  });

  it("includes a strategy exactly on the 3% threshold", () => {
    const p = toProduct(
      strat({
        id: "S",
        asset: "XETH",
        apr_estimate: { low: "3.0000" },
        lock_type: { type: "flex" },
      }),
      assets,
    );
    expect(p?.apyValue).toBe(3);
  });

  it("sets eligibleTiers to Premium/Private for a bonded strategy", () => {
    const p = toProduct(
      strat({
        id: "S",
        asset: "SOL",
        lock_type: { type: "bonded", unbonding_period: 100 },
      }),
      assets,
    );
    expect(p?.eligibleTiers).toEqual(["Premium", "Private"]);
  });
});
