// src/domain/tiers.ts
import { AppError } from "../errors";
import type { RawLockType } from "../meridian/schema";

export type Tier = "Standard" | "Premium" | "Private";
export type AccessModel = "instant-access" | "restricted";

const RESTRICTED_TYPES = new Set(["bonded", "hybrid", "timed"]);
// `flex` is intentionally absent: Meridian Rewards strategies are filtered out
// before tiering (see transform.ts), so flex never reaches accessModel.
const INSTANT_TYPES = new Set(["instant"]);

/**
 * Classifies a lock type by withdrawal-side structural signals.
 * `bonding_period` is deliberately ignored — it delays when rewards start, not withdrawal.
 */
export function accessModel(lockType: RawLockType): AccessModel {
  const hasLockSignal =
    (lockType.unbonding_period ?? 0) > 0 ||
    (lockType.exit_queue_period ?? 0) > 0 ||
    lockType.delayed_withdrawals === true ||
    lockType.duration_months !== undefined ||
    RESTRICTED_TYPES.has(lockType.type);

  if (hasLockSignal) return "restricted";
  if (INSTANT_TYPES.has(lockType.type)) return "instant-access";
  return "restricted"; // unknown type, no instant-access signal → conservative default
}

/** The Aurora customer tiers that may see a strategy with this access model. */
export function eligibleTiers(model: AccessModel): Tier[] {
  return model === "instant-access"
    ? ["Standard", "Premium", "Private"]
    : ["Premium", "Private"];
}

/** Parses the ?tier query param (case-insensitive). Throws AppError(INVALID_TIER) if invalid. */
export function parseTier(raw: unknown): Tier {
  const normalised = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  switch (normalised) {
    case "standard":
      return "Standard";
    case "premium":
      return "Premium";
    case "private":
      return "Private";
    default:
      throw new AppError(
        "INVALID_TIER",
        "tier must be one of: standard, premium, private",
      );
  }
}
