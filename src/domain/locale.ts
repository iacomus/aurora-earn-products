// src/domain/locale.ts
import type Big from "big.js";
import { AppError } from "../errors";

const DEFAULT_LOCALE = "en-US";

/**
 * Validates and canonicalises the `?locale` query param.
 *
 * Absent or empty → `en-US`, the canonical default that matches the brief's
 * example output. A well-formed BCP 47 tag is returned canonicalised
 * (`de-de` → `de-DE`). A malformed tag — e.g. `de_DE`, an underscore instead
 * of a hyphen — throws `AppError(INVALID_LOCALE)`, surfacing the client typo
 * rather than silently formatting in the wrong locale. A well-formed but
 * unrecognised tag is accepted; `Intl` falls back to a sensible default.
 */
export function parseLocale(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    return DEFAULT_LOCALE;
  }
  try {
    const [canonical] = Intl.getCanonicalLocales(raw.trim());
    return canonical ?? DEFAULT_LOCALE;
  } catch {
    throw new AppError(
      "INVALID_LOCALE",
      `locale "${raw}" is not a valid BCP 47 language tag`,
    );
  }
}

/**
 * Formats an APY percentage as a localised display string — `"4.25%"` (en-US),
 * `"4,25 %"` (de-DE), `"%4,25"` (tr-TR). `apyPercent` is the exact-decimal APY
 * (computeApy's output); `Intl` rounds the display to two fraction digits,
 * matching the precision of the numeric `apyValue`.
 */
export function formatApyDisplay(apyPercent: Big, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(apyPercent.div(100).toNumber());
}
