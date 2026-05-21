// test/errors.test.ts
import { describe, it, expect } from "vitest";
import { AppError, toStructuredError } from "../src/errors";

describe("AppError", () => {
  it("carries code, message, and the mapped HTTP status", () => {
    const err = new AppError("INVALID_TIER", "bad tier");
    expect(err.code).toBe("INVALID_TIER");
    expect(err.message).toBe("bad tier");
    expect(err.httpStatus).toBe(400);
    expect(err).toBeInstanceOf(Error);
  });

  it("maps data errors to HTTP 500", () => {
    expect(new AppError("DATA_MALFORMED", "x").httpStatus).toBe(500);
    expect(new AppError("DATA_UNAVAILABLE", "x").httpStatus).toBe(500);
    expect(new AppError("DATA_UPSTREAM_ERROR", "x").httpStatus).toBe(500);
  });
});

describe("toStructuredError", () => {
  it("maps an AppError to its status and structured body", () => {
    const result = toStructuredError(
      new AppError("DATA_MALFORMED", "bad file"),
    );
    expect(result).toEqual({
      status: 500,
      body: { error: { code: "DATA_MALFORMED", message: "bad file" } },
    });
  });

  it("maps an unknown throwable to 500 without leaking its message", () => {
    const result = toStructuredError(new Error("stack trace leak"));
    expect(result.status).toBe(500);
    expect(result.body.error.code).toBe("INTERNAL_ERROR");
    expect(result.body.error.message).not.toContain("stack trace leak");
  });
});
