import { z } from "zod";

/** A string that parses to a finite number, e.g. "4.0000". */
const numericString = z
  .string()
  .refine((s) => s.trim() !== "" && Number.isFinite(Number(s)), {
    message: "expected a numeric string",
  });

export const lockTypeSchema = z
  .object({
    type: z.string(),
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
    status: z.string(),
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
