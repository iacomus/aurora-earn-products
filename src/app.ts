// src/app.ts
import express, { type Express } from "express";
import type { MeridianEarnClient } from "./meridian/client";
import { earnProductsHandler } from "./routes/earn-products";

/** Builds the Express app wired to a Meridian client. */
export function createApp(client: MeridianEarnClient): Express {
  const app = express();
  app.get("/earn-products", earnProductsHandler(client));
  return app;
}
