import { describe, it, expect } from 'vitest';
import { strategySchema, assetSchema, strategiesEnvelopeSchema } from '../src/meridian/schema';

const validStrategy = {
  id: 'ESDQCOL-WTZEU-NU55QF',
  asset: 'XETH',
  lock_type: { type: 'bonded', unbonding_period: 333615 },
  apr_estimate: { low: '4.0000', high: '5.0000' },
  user_min_allocation: '0.01',
  auto_compound: { type: 'disabled' },
  can_allocate: true,
};

describe('strategySchema', () => {
  it('accepts a valid strategy and keeps unknown keys', () => {
    const parsed = strategySchema.parse({ ...validStrategy, yield_source: { type: 'staking' } });
    expect(parsed.id).toBe('ESDQCOL-WTZEU-NU55QF');
  });

  it('accepts a strategy with no apr_estimate (the MINA case)', () => {
    const { apr_estimate, ...noApr } = validStrategy;
    expect(strategySchema.safeParse(noApr).success).toBe(true);
  });

  it('rejects a strategy missing id', () => {
    const { id, ...noId } = validStrategy;
    expect(strategySchema.safeParse(noId).success).toBe(false);
  });

  it('rejects a present apr_estimate whose low is not numeric', () => {
    const bad = { ...validStrategy, apr_estimate: { low: 'abc' } };
    expect(strategySchema.safeParse(bad).success).toBe(false);
  });
});

describe('assetSchema', () => {
  it('accepts a valid asset', () => {
    expect(assetSchema.safeParse({ altname: 'ETH', status: 'enabled' }).success).toBe(true);
  });
  it('rejects an asset missing altname', () => {
    expect(assetSchema.safeParse({ status: 'enabled' }).success).toBe(false);
  });
});

describe('strategiesEnvelopeSchema', () => {
  it('accepts the Meridian envelope shape', () => {
    const parsed = strategiesEnvelopeSchema.parse({
      error: [],
      result: { next_cursor: null, items: [validStrategy] },
    });
    expect(parsed.result.items).toHaveLength(1);
  });
});
