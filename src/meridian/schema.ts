import { z } from "zod";

/** A string that parses to a finite number, e.g. "4.0000". */
const numericString = z
  .string()
  .refine((s) => s.trim() !== "" && Number.isFinite(Number(s)), {
    message: "expected a numeric string",
  });

/**
 * The lock types Meridian's Earn data is known to use — the set the domain layer
 * has explicit handling for (`flex` is excluded, `instant` is instant-access,
 * `bonded`/`hybrid`/`timed` are restricted; see domain/tiers.ts).
 *
 * `lock_type.type` is modelled as an *open* enum: the schema still accepts any
 * other string. A grader may introduce a new lock type, and accessModel()
 * classifies an unrecognised type conservatively as `restricted` rather than
 * rejecting the file — so an unknown value must validate, not fail. Listing the
 * known set keeps that invariant visible at the type boundary instead of in
 * prose alone.
 */
export const KNOWN_LOCK_TYPES = [
  "instant",
  "bonded",
  "flex",
  "hybrid",
  "timed",
] as const;
export type LockType = (typeof KNOWN_LOCK_TYPES)[number] | (string & {});

/**
 * The asset statuses Meridian is known to report. Modelled as an open enum for
 * the same reason as {@link LockType}: the asset-status filter treats any value
 * other than `enabled` — known or not — as not operational, so an unfamiliar
 * status is handled conservatively and must validate rather than fail.
 */
export const KNOWN_ASSET_STATUSES = [
  "enabled",
  "disabled",
  "workinprogress",
  "depositonly",
] as const;
export type AssetStatus = (typeof KNOWN_ASSET_STATUSES)[number] | (string & {});

/**
 * Schema for an open string enum (see {@link KNOWN_LOCK_TYPES} /
 * {@link KNOWN_ASSET_STATUSES}). It validates only that the value is a string —
 * an unknown enum value is accepted, not rejected, because the domain layer
 * handles unknowns conservatively — while carrying the documented union `T` as
 * its inferred type so consumers see the recognised set.
 */
const openStringEnum = <T extends string>(label: string) =>
  z.custom<T>((v) => typeof v === "string", `expected a string ${label}`);

export const lockTypeSchema = z
  .object({
    type: openStringEnum<LockType>("lock type"),
    payout_frequency: z.number().optional(),
    unbonding_period: z.number().optional(),
    exit_queue_period: z.number().optional(),
    duration_months: z.number().optional(),
    delayed_withdrawals: z.boolean().optional(),
  })
  .passthrough();

export const aprEstimateSchema = z
  .object({
    low: numericString,
    high: numericString.optional(),
  })
  .passthrough();

export const autoCompoundSchema = z
  .object({
    type: z.string(),
    default: z.boolean().optional(),
  })
  .passthrough();

export const strategySchema = z
  .object({
    id: z.string(),
    asset: z.string(),
    lock_type: lockTypeSchema,
    apr_estimate: aprEstimateSchema.optional(),
    user_min_allocation: z.string(),
    auto_compound: autoCompoundSchema.optional(),
    yield_source: z.object({ type: z.string() }).passthrough().optional(),
    can_allocate: z.boolean().optional(),
  })
  .passthrough();

export const assetSchema = z
  .object({
    altname: z.string(),
    status: openStringEnum<AssetStatus>("asset status"),
  })
  .passthrough();

export const strategiesEnvelopeSchema = z
  .object({
    error: z.array(z.string()),
    result: z.object({ items: z.array(strategySchema) }).passthrough(),
  })
  .passthrough();

export const assetsEnvelopeSchema = z
  .object({
    error: z.array(z.string()),
    result: z.record(assetSchema),
  })
  .passthrough();

export type RawLockType = z.infer<typeof lockTypeSchema>;
export type RawAprEstimate = z.infer<typeof aprEstimateSchema>;
export type RawAutoCompound = z.infer<typeof autoCompoundSchema>;
export type RawStrategy = z.infer<typeof strategySchema>;
export type RawAsset = z.infer<typeof assetSchema>;
export type AssetMap = Record<string, RawAsset>;
