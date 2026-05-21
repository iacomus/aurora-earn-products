// test/transform.test.ts
import { describe, it, expect } from "vitest";
import {
  buildProduct,
  displayName,
  resolveAsset,
} from "../src/domain/transform";
import type { AssetMap, RawAsset, RawStrategy } from "../src/meridian/schema";

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
  });

  it("omits the lock word for a lock type with no mapping (e.g. hybrid)", () => {
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
  });

  it("falls back to 'Earn' when the yield source is absent", () => {
    expect(
      displayName(
        strat({ id: "S", asset: "XETH", lock_type: { type: "instant" } }),
        "ETH",
      ),
    ).toBe("ETH Flexible Earn");
  });
});

describe("resolveAsset", () => {
  const assets: AssetMap = { XETH: { altname: "ETH", status: "enabled" } };

  it("returns the asset for a known code", () => {
    expect(
      resolveAsset(strat({ id: "S", asset: "XETH" }), assets).altname,
    ).toBe("ETH");
  });

  it("throws DATA_MALFORMED for an unknown asset code", () => {
    expect(() =>
      resolveAsset(strat({ id: "S", asset: "NOPE" }), assets),
    ).toThrowError(/unknown asset code/);
  });
});

describe("buildProduct", () => {
  const eth: RawAsset = { altname: "ETH", status: "enabled" };

  it("builds the EarnProduct output shape", () => {
    const product = buildProduct(
      strat({ id: "S1", asset: "XETH", yield_source: { type: "staking" } }),
      eth,
      8,
    );
    expect(product).toEqual({
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

  it("rounds apyValue to 2 decimals and formats apyDisplay", () => {
    const product = buildProduct(strat({ id: "S", asset: "XETH" }), eth, 8.327);
    expect(product.apyValue).toBe(8.33);
    expect(product.apyDisplay).toBe("8.33%");
  });

  it("uses the asset altname (POL → MATIC)", () => {
    const product = buildProduct(
      strat({ id: "S", asset: "POL" }),
      { altname: "MATIC", status: "enabled" },
      5,
    );
    expect(product.asset).toBe("MATIC");
  });

  it("sets eligibleTiers to Premium/Private for a bonded strategy", () => {
    const product = buildProduct(
      strat({
        id: "S",
        asset: "SOL",
        lock_type: { type: "bonded", unbonding_period: 100 },
      }),
      { altname: "SOL", status: "enabled" },
      5,
    );
    expect(product.eligibleTiers).toEqual(["Premium", "Private"]);
  });
});
