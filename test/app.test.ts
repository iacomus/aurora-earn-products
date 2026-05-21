// test/app.test.ts
import { describe, it, expect } from "vitest";
import express, { type Request, type Response } from "express";
import request from "supertest";
import { structuredErrorHandler } from "../src/app";
import { AppError } from "../src/errors";

/** A minimal app whose one route always throws `err`, with the backstop handler. */
function appThatThrows(err: unknown) {
  const app = express();
  app.get("/boom", () => {
    throw err;
  });
  app.use(structuredErrorHandler);
  return app;
}

describe("structuredErrorHandler", () => {
  it("renders an AppError that escapes a route as a structured response", async () => {
    const res = await request(
      appThatThrows(new AppError("DATA_MALFORMED", "bad file")),
    ).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: "DATA_MALFORMED", message: "bad file" },
    });
  });

  it("maps an INVALID_TIER AppError to its 400 status", async () => {
    const res = await request(
      appThatThrows(new AppError("INVALID_TIER", "bad tier")),
    ).get("/boom");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TIER");
  });

  it("masks an unexpected throwable as INTERNAL_ERROR without leaking its message", async () => {
    const res = await request(
      appThatThrows(new Error("stack trace leak")),
    ).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(res.body)).not.toContain("stack trace leak");
  });

  it("delegates to the default handler once the response is already sent", () => {
    // Writing a second status/body after headers are flushed would throw;
    // the handler must hand the error back to Express instead.
    let forwarded: unknown;
    const sentResponse = { headersSent: true } as Response;
    structuredErrorHandler(
      new AppError("DATA_MALFORMED", "too late"),
      {} as Request,
      sentResponse,
      (err) => {
        forwarded = err;
      },
    );
    expect(forwarded).toBeInstanceOf(AppError);
  });
});
