// src/app.ts
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { MeridianEarnClient } from "./meridian/client";
import { earnProductsHandler } from "./routes/earn-products";
import { toStructuredError } from "./errors";

/** Builds the Express app wired to a Meridian client. */
export function createApp(client: MeridianEarnClient): Express {
  const app = express();
  app.get("/earn-products", earnProductsHandler(client));
  // Registered last: Express routes any error escaping a handler above to it.
  app.use(structuredErrorHandler);
  return app;
}

/**
 * Backstop error handler. The route handlers already map their own failures to
 * structured responses, so in practice this fires only for an unforeseen throw
 * — but it is the guarantee that a raw stack trace can never reach a client,
 * for this route or any added later. Express recognises an error handler by
 * its four-argument signature.
 */
export function structuredErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  // The response is already on the wire — let Express's default handler close
  // the connection rather than writing a second set of headers.
  if (res.headersSent) {
    next(err);
    return;
  }
  const { status, body } = toStructuredError(err);
  res.status(status).json(body);
}
