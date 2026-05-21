// test/earn-products-service.test.ts
import { describe, it, expect } from "vitest";
import { getEarnProducts } from "../src/domain/earn-products";
import type { MeridianEarnClient } from "../src/meridian/client";
import type { RawStrategy, AssetMap } from "../src/meridian/schema";

const assets: AssetMap = {
  XETH: { altname: "ETH", status: "enabled" },
  SOL: { altname: "SOL", status: "enabled" },
  POL: { altname: "MATIC", status: "enabled" },
};

const instant = (id: string, asset: string, low: string): RawStrategy => ({
  id,
  asset,
  lock_type: { type: "instant", payout_frequency: 604800 },
  apr_estimate: { low },
  user_min_allocation: "0",
  auto_compound: { type: "disabled" },
  can_allocate: true,
});

const bonded = (id: string, asset: string, low: string): RawStrategy => ({
  id,
  asset,
  lock_type: { type: "bonded", unbonding_period: 1000 },
  apr_estimate: { low },
  user_min_allocation: "0",
  auto_compound: { type: "disabled" },
  can_allocate: true,
});

function fakeClient(
  strategies: RawStrategy[],
  assetMap: AssetMap = assets,
): MeridianEarnClient {
  return {
    listStrategies: async () => strategies,
    listAssets: async () => assetMap,
  };
}

describe("getEarnProducts", () => {
  it("returns instant-access products only for the Standard tier", async () => {
    const client = fakeClient([
      instant("S-INSTANT", "XETH", "8.0000"),
      bonded("S-BONDED", "SOL", "5.0000"),
    ]);
    const result = await getEarnProducts(client, "Standard");
    expect(result.map((p) => p.strategyId)).toEqual(["S-INSTANT"]);
  });

  it("returns all qualifying products for Premium and Private", async () => {
    const client = fakeClient([
      instant("S-INSTANT", "XETH", "8.0000"),
      bonded("S-BONDED", "SOL", "5.0000"),
    ]);
    expect(
      (await getEarnProducts(client, "Premium")).map((p) => p.strategyId),
    ).toEqual(["S-INSTANT", "S-BONDED"]);
    expect(await getEarnProducts(client, "Private")).toHaveLength(2);
  });

  it("sorts by APY descending", async () => {
    const client = fakeClient([
      instant("S-LOW", "XETH", "4.0000"),
      instant("S-HIGH", "SOL", "9.0000"),
      instant("S-MID", "POL", "6.0000"),
    ]);
    expect(
      (await getEarnProducts(client, "Premium")).map((p) => p.apyValue),
    ).toEqual([9, 6, 4]);
  });

  it("breaks APY ties by strategyId ascending", async () => {
    const client = fakeClient([
      instant("S-ZEBRA", "XETH", "8.0000"),
      instant("S-ALPHA", "SOL", "8.0000"),
    ]);
    expect(
      (await getEarnProducts(client, "Premium")).map((p) => p.strategyId),
    ).toEqual(["S-ALPHA", "S-ZEBRA"]);
  });

  it("sorts by the unrounded APY when two products round to the same apyValue", async () => {
    // Both round to apyValue 3.01; only the unrounded APY (3.014 > 3.012) separates them,
    // so S-ZULU must come first despite its alphabetically later strategyId.
    const client = fakeClient([
      instant("S-ZULU", "XETH", "3.0140"),
      instant("S-ALFA", "SOL", "3.0120"),
    ]);
    const result = await getEarnProducts(client, "Premium");
    expect(result.map((p) => p.strategyId)).toEqual(["S-ZULU", "S-ALFA"]);
    expect(result.map((p) => p.apyValue)).toEqual([3.01, 3.01]);
  });

  it("excludes sub-3% strategies", async () => {
    const client = fakeClient([instant("S-LOW", "XETH", "2.0000")]);
    expect(await getEarnProducts(client, "Premium")).toEqual([]);
  });

  it("propagates DATA_MALFORMED when a strategy references an unknown asset", async () => {
    const client = fakeClient([instant("S", "GHOST", "8.0000")]);
    await expect(getEarnProducts(client, "Premium")).rejects.toMatchObject({
      code: "DATA_MALFORMED",
    });
  });
});
