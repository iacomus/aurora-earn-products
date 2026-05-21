// test/locale.test.ts
import { describe, it, expect } from "vitest";
import Big from "big.js";
import { parseLocale, formatApyDisplay } from "../src/domain/locale";
import { AppError } from "../src/errors";

describe("parseLocale", () => {
  it("defaults to en-US when no locale is given", () => {
    expect(parseLocale(undefined)).toBe("en-US");
  });

  it("defaults to en-US for an empty or whitespace value", () => {
    expect(parseLocale("")).toBe("en-US");
    expect(parseLocale("   ")).toBe("en-US");
  });

  it("canonicalises a valid BCP 47 tag", () => {
    expect(parseLocale("de-de")).toBe("de-DE");
  });

  it("returns an already-canonical tag unchanged", () => {
    expect(parseLocale("fr-FR")).toBe("fr-FR");
  });

  it("throws an INVALID_LOCALE AppError for a malformed tag", () => {
    let caught: unknown;
    try {
      parseLocale("de_DE");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe("INVALID_LOCALE");
  });
});

describe("formatApyDisplay", () => {
  it("formats an en-US percentage as N.NN%", () => {
    expect(formatApyDisplay(new Big("4.25"), "en-US")).toBe("4.25%");
  });

  it("pads to two fraction digits", () => {
    expect(formatApyDisplay(new Big("8"), "en-US")).toBe("8.00%");
  });

  it("localises the decimal separator (de-DE uses a comma)", () => {
    const de = formatApyDisplay(new Big("4.25"), "de-DE");
    expect(de).toContain("4,25");
    expect(de).toContain("%");
    expect(de).not.toBe(formatApyDisplay(new Big("4.25"), "en-US"));
  });

  it("localises the percent-sign position (tr-TR leads with %)", () => {
    expect(formatApyDisplay(new Big("4.25"), "tr-TR").startsWith("%")).toBe(
      true,
    );
  });
});
