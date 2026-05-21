// test/mock-client.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileMockMeridianClient } from '../src/meridian/mock-client';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'earn-test-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function write(name: string, content: unknown): Promise<void> {
  await fs.writeFile(path.join(dir, name), JSON.stringify(content), 'utf8');
}

const strategy = (id: string, asset = 'XETH') => ({
  id,
  asset,
  lock_type: { type: 'instant', payout_frequency: 604800 },
  apr_estimate: { low: '4.0000', high: '5.0000' },
  user_min_allocation: '0.01',
  auto_compound: { type: 'enabled' },
  can_allocate: true,
});
const strategiesEnvelope = (...items: object[]) => ({ error: [], result: { items } });
const assetsEnvelope = (assets: object) => ({ error: [], result: assets });

describe('FileMockMeridianClient', () => {
  it('reads strategies and assets from the directory', async () => {
    await write('strategies.json', strategiesEnvelope(strategy('S1')));
    await write('assets.json', assetsEnvelope({ XETH: { altname: 'ETH', status: 'enabled' } }));
    const client = new FileMockMeridianClient(dir);
    expect(await client.listStrategies()).toHaveLength(1);
    expect((await client.listAssets()).XETH!.altname).toBe('ETH');
  });

  it('merges strategies across multiple files', async () => {
    await write('a.json', strategiesEnvelope(strategy('S1')));
    await write('b.json', strategiesEnvelope(strategy('S2')));
    const client = new FileMockMeridianClient(dir);
    expect((await client.listStrategies()).map((s) => s.id).sort()).toEqual(['S1', 'S2']);
  });

  it('dedupes strategies by id, last file wins', async () => {
    await write('a.json', strategiesEnvelope({ ...strategy('S1'), asset: 'XETH' }));
    await write('z.json', strategiesEnvelope({ ...strategy('S1'), asset: 'SOL' }));
    const client = new FileMockMeridianClient(dir);
    const all = await client.listStrategies();
    expect(all).toHaveLength(1);
    expect(all[0]!.asset).toBe('SOL');
  });

  it('throws DATA_UNAVAILABLE when the directory is missing', async () => {
    const client = new FileMockMeridianClient(path.join(dir, 'nope'));
    await expect(client.listStrategies()).rejects.toMatchObject({ code: 'DATA_UNAVAILABLE' });
  });

  it('throws DATA_UNAVAILABLE when no JSON files are present', async () => {
    await fs.writeFile(path.join(dir, 'readme.txt'), 'hi', 'utf8');
    const client = new FileMockMeridianClient(dir);
    await expect(client.listStrategies()).rejects.toMatchObject({ code: 'DATA_UNAVAILABLE' });
  });

  it('throws DATA_MALFORMED on invalid JSON', async () => {
    await fs.writeFile(path.join(dir, 'bad.json'), '{not json', 'utf8');
    const client = new FileMockMeridianClient(dir);
    await expect(client.listStrategies()).rejects.toMatchObject({ code: 'DATA_MALFORMED' });
  });

  it('throws DATA_UPSTREAM_ERROR when a file has a non-empty error array', async () => {
    await write('err.json', { error: ['EAPI:Bad request'], result: { items: [] } });
    const client = new FileMockMeridianClient(dir);
    await expect(client.listStrategies()).rejects.toMatchObject({ code: 'DATA_UPSTREAM_ERROR' });
  });

  it('throws DATA_MALFORMED when a strategies file fails schema validation', async () => {
    await write('bad.json', { error: [], result: { items: [{ asset: 'XETH' }] } });
    const client = new FileMockMeridianClient(dir);
    await expect(client.listStrategies()).rejects.toMatchObject({ code: 'DATA_MALFORMED' });
  });

  it('ignores JSON files that are neither strategies nor assets', async () => {
    await write('strategies.json', strategiesEnvelope(strategy('S1')));
    await write('other.json', { something: 'unrelated' });
    const client = new FileMockMeridianClient(dir);
    expect(await client.listStrategies()).toHaveLength(1);
  });

  it('throws DATA_MALFORMED when an assets file has a corrupt entry', async () => {
    await write('assets.json', {
      error: [],
      result: {
        XETH: { altname: 'ETH', status: 'enabled' },
        BAD: { status: 'enabled' },
      },
    });
    const client = new FileMockMeridianClient(dir);
    await expect(client.listAssets()).rejects.toMatchObject({ code: 'DATA_MALFORMED' });
  });

  it('caches the loaded data — a second call does not re-read the directory', async () => {
    await write('strategies.json', strategiesEnvelope(strategy('S1')));
    await write('assets.json', assetsEnvelope({ XETH: { altname: 'ETH', status: 'enabled' } }));
    const client = new FileMockMeridianClient(dir);
    const first = await client.listStrategies();
    await fs.rm(path.join(dir, 'strategies.json'));
    const second = await client.listStrategies();
    expect(second).toBe(first);
  });
});
