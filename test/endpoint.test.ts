// test/endpoint.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import { createApp } from '../src/app';
import { FileMockMeridianClient } from '../src/meridian/mock-client';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'earn-e2e-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function write(name: string, content: unknown): Promise<void> {
  await fs.writeFile(path.join(dir, name), JSON.stringify(content), 'utf8');
}

const strategiesEnvelope = (...items: object[]) => ({ error: [], result: { items } });
const assetsEnvelope = (assetsObj: object) => ({ error: [], result: assetsObj });

const instant = (id: string, asset: string, low: string) => ({
  id,
  asset,
  lock_type: { type: 'instant', payout_frequency: 604800 },
  apr_estimate: { low },
  user_min_allocation: '0.01',
  auto_compound: { type: 'disabled' },
  yield_source: { type: 'staking' },
  can_allocate: true,
});
const bonded = (id: string, asset: string, low: string) => ({
  id,
  asset,
  lock_type: { type: 'bonded', unbonding_period: 1000 },
  apr_estimate: { low },
  user_min_allocation: '0.01',
  auto_compound: { type: 'disabled' },
  yield_source: { type: 'staking' },
  can_allocate: true,
});

async function seed(): Promise<void> {
  await write('strategies.json', strategiesEnvelope(instant('S-INSTANT', 'XETH', '8.0000'), bonded('S-BONDED', 'SOL', '5.0000')));
  await write('assets.json', assetsEnvelope({
    XETH: { altname: 'ETH', status: 'enabled' },
    SOL: { altname: 'SOL', status: 'enabled' },
  }));
}

describe('GET /earn-products', () => {
  it('returns instant-access products only for tier=standard', async () => {
    await seed();
    const res = await request(createApp(new FileMockMeridianClient(dir))).get('/earn-products?tier=standard');
    expect(res.status).toBe(200);
    expect(res.body.map((p: { strategyId: string }) => p.strategyId)).toEqual(['S-INSTANT']);
  });

  it('returns all qualifying products, APY-sorted, for tier=premium', async () => {
    await seed();
    const res = await request(createApp(new FileMockMeridianClient(dir))).get('/earn-products?tier=premium');
    expect(res.status).toBe(200);
    expect(res.body.map((p: { strategyId: string }) => p.strategyId)).toEqual(['S-INSTANT', 'S-BONDED']);
  });

  it('400s with a structured error for an invalid tier', async () => {
    await seed();
    const res = await request(createApp(new FileMockMeridianClient(dir))).get('/earn-products?tier=gold');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TIER');
  });

  it('400s when tier is missing', async () => {
    await seed();
    const res = await request(createApp(new FileMockMeridianClient(dir))).get('/earn-products');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TIER');
  });

  it('500s with a structured error when the data directory is missing', async () => {
    const res = await request(createApp(new FileMockMeridianClient(path.join(dir, 'absent')))).get('/earn-products?tier=premium');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('DATA_UNAVAILABLE');
  });

  it('returns an empty array when no product qualifies for the tier', async () => {
    await write('strategies.json', strategiesEnvelope(bonded('S-BONDED', 'SOL', '5.0000')));
    await write('assets.json', assetsEnvelope({ SOL: { altname: 'SOL', status: 'enabled' } }));
    const res = await request(createApp(new FileMockMeridianClient(dir))).get('/earn-products?tier=standard');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
