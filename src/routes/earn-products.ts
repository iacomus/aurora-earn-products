// src/routes/earn-products.ts
import type { Request, Response } from 'express';
import type { MeridianEarnClient } from '../meridian/client';
import { getEarnProducts } from '../domain/earn-products';
import { parseTier } from '../domain/tiers';
import { toStructuredError } from '../errors';

/** Builds the GET /earn-products handler, bound to a Meridian client. */
export function earnProductsHandler(client: MeridianEarnClient) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const tier = parseTier(req.query.tier);
      const products = await getEarnProducts(client, tier);
      res.status(200).json(products);
    } catch (err) {
      const { status, body } = toStructuredError(err);
      res.status(status).json(body);
    }
  };
}
