// test/tiers.test.ts
import { describe, it, expect } from "vitest";
import { accessModel, eligibleTiers, parseTier } from "../src/domain/tiers";
import type { RawLockType } from "../src/meridian/schema";

const lock = (props: Record<string, unknown>): RawLockType =>
  props as RawLockType;

describe("accessModel", () => {
  it("treats instant and flex as instant-access", () => {
    expect(
      accessModel(lock({ type: "instant", payout_frequency: 604800 })),
    ).toBe("instant-access");
    expect(accessModel(lock({ type: "flex" }))).toBe("instant-access");
  });

  it("treats bonded, hybrid, and timed as restricted", () => {
    expect(
      accessModel(lock({ type: "bonded", unbonding_period: 333615 })),
    ).toBe("restricted");
    expect(
      accessModel(
        lock({
          type: "hybrid",
          unbonding_period: 99999,
          delayed_withdrawals: true,
        }),
      ),
    ).toBe("restricted");
    expect(accessModel(lock({ type: "timed", duration_months: 3 }))).toBe(
      "restricted",
    );
  });

  it("treats an exit queue or delayed withdrawals as restricted regardless of type", () => {
    expect(accessModel(lock({ type: "instant", exit_queue_period: 100 }))).toBe(
      "restricted",
    );
    expect(
      accessModel(lock({ type: "instant", delayed_withdrawals: true })),
    ).toBe("restricted");
  });

  it("does not treat a bonding period as a restricted-access signal", () => {
    expect(
      accessModel(
        lock({
          type: "instant",
          bonding_period: 172800,
          payout_frequency: 604800,
        }),
      ),
    ).toBe("instant-access");
  });

  it("treats an unknown lock type as restricted (conservative default)", () => {
    expect(accessModel(lock({ type: "quantum-vault" }))).toBe("restricted");
  });
});

describe("eligibleTiers", () => {
  it("gives instant-access strategies to all three tiers", () => {
    expect(eligibleTiers("instant-access")).toEqual([
      "Standard",
      "Premium",
      "Private",
    ]);
  });
  it("restricts the rest to Premium and Private", () => {
    expect(eligibleTiers("restricted")).toEqual(["Premium", "Private"]);
  });
});

describe("parseTier", () => {
  it("parses the three tiers case-insensitively", () => {
    expect(parseTier("standard")).toBe("Standard");
    expect(parseTier("PREMIUM")).toBe("Premium");
    expect(parseTier("  private ")).toBe("Private");
  });
  it("throws INVALID_TIER for anything else", () => {
    expect(() => parseTier("gold")).toThrowError(/tier must be one of/);
    expect(() => parseTier(undefined)).toThrowError(/tier must be one of/);
  });
});
