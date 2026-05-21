# Aurora Bank Earn Products Service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript HTTP service exposing `GET /earn-products?tier=` that reads mock Meridian Earn data from `data/`, applies Aurora Bank's business rules, and returns a sorted JSON array — runnable via `docker-compose up`.

**Architecture:** Three layers. A **Meridian API client** (`meridian/`) — a `MeridianEarnClient` interface with a file-backed `FileMockMeridianClient` that reads captured responses from `data/`. A **pure domain layer** (`domain/`) — APY conversion, tier model, transform/filter/sort, no I/O. A **thin HTTP layer** (`routes/`, `app.ts`, `server.ts`) — Express, validates `tier`, maps errors to structured responses.

**Tech Stack:** TypeScript (CommonJS), Express 4, Zod 3, Vitest + Supertest, Docker (`node:22-slim`, multi-stage).

**Reference spec:** `docs/superpowers/specs/2026-05-20-aurora-earn-products-service-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts` | Toolchain config |
| `src/errors.ts` | `AppError` class, error codes, structured-error mapping |
| `src/meridian/schema.ts` | Zod schemas for the Meridian envelope / strategy / asset + inferred types |
| `src/meridian/client.ts` | `MeridianEarnClient` interface |
| `src/meridian/mock-client.ts` | `FileMockMeridianClient` — glob `data/`, classify captures, validate, merge |
| `src/domain/apy.ts` | APR → APY conversion (pure) |
| `src/domain/tiers.ts` | lock_type → access model → `eligibleTiers`; `parseTier` (pure) |
| `src/domain/transform.ts` | raw strategy + asset map → `EarnProduct \| null` (pure) |
| `src/domain/earn-products.ts` | Orchestrate: client → transform → filter by tier → sort |
| `src/config.ts` | `DATA_DIR`, `PORT` |
| `src/routes/earn-products.ts` | `GET /earn-products` handler |
| `src/app.ts` | Express app + route wiring + error handler |
| `src/server.ts` | Bootstrap — listen on `0.0.0.0:3000` |
| `Dockerfile`, `docker-compose.yml`, `.dockerignore` | Containerisation |
| `README.md`, `solution-design-note.md` | Deliverables |
| `test/*.test.ts` | Vitest suites (one per domain/client/route module) |

**Import convention:** CommonJS module resolution — imports use no file extension (`import { AppError } from '../errors'`).

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.dockerignore`
- Create: `src/`, `test/` directories

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "aurora-earn-products",
  "version": "1.0.0",
  "private": true,
  "description": "Aurora Bank earn products service (Meridian Earn integration PoC)",
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "tsx watch src/server.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "express": "^4.21.2",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.10.0",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.0",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
*.log
```

- [ ] **Step 5: Create `.dockerignore`**

```
node_modules
dist
.git
*.log
docs
test
```

- [ ] **Step 6: Install dependencies and create source dirs**

Run: `npm install && mkdir -p src/meridian src/domain src/routes test`
Expected: `npm install` completes, `node_modules/` and `package-lock.json` created.

- [ ] **Step 7: Verify the toolchain is installed**

Run: `npx tsc --version && npx vitest --version`
Expected: both print a version number and exit 0. (Do not run `tsc --noEmit` yet — it errors
on an empty `src/`; the first real `tsc` check is in Task 4.)

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .dockerignore
git commit -m "chore: project scaffold and toolchain"
```

---

## Task 2: Error model (`src/errors.ts`)

**Files:**
- Create: `src/errors.ts`
- Test: `test/errors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/errors.test.ts
import { describe, it, expect } from 'vitest';
import { AppError, toStructuredError } from '../src/errors';

describe('AppError', () => {
  it('carries code, message, and the mapped HTTP status', () => {
    const err = new AppError('INVALID_TIER', 'bad tier');
    expect(err.code).toBe('INVALID_TIER');
    expect(err.message).toBe('bad tier');
    expect(err.httpStatus).toBe(400);
    expect(err).toBeInstanceOf(Error);
  });

  it('maps data errors to HTTP 500', () => {
    expect(new AppError('DATA_MALFORMED', 'x').httpStatus).toBe(500);
    expect(new AppError('DATA_UNAVAILABLE', 'x').httpStatus).toBe(500);
    expect(new AppError('DATA_UPSTREAM_ERROR', 'x').httpStatus).toBe(500);
  });
});

describe('toStructuredError', () => {
  it('maps an AppError to its status and structured body', () => {
    const result = toStructuredError(new AppError('DATA_MALFORMED', 'bad file'));
    expect(result).toEqual({
      status: 500,
      body: { error: { code: 'DATA_MALFORMED', message: 'bad file' } },
    });
  });

  it('maps an unknown throwable to 500 without leaking its message', () => {
    const result = toStructuredError(new Error('stack trace leak'));
    expect(result.status).toBe(500);
    expect(result.body.error.code).toBe('INTERNAL_ERROR');
    expect(result.body.error.message).not.toContain('stack trace leak');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/errors.test.ts`
Expected: FAIL — cannot find module `../src/errors`.

- [ ] **Step 3: Write the implementation**

```ts
// src/errors.ts
export type ErrorCode =
  | 'INVALID_TIER'
  | 'DATA_UNAVAILABLE'
  | 'DATA_MALFORMED'
  | 'DATA_UPSTREAM_ERROR'
  | 'INTERNAL_ERROR';

const HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_TIER: 400,
  DATA_UNAVAILABLE: 500,
  DATA_MALFORMED: 500,
  DATA_UPSTREAM_ERROR: 500,
  INTERNAL_ERROR: 500,
};

/** An error with a stable code and a client-safe message. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
  }
}

export interface StructuredError {
  error: { code: ErrorCode; message: string };
}

/** Maps any throwable to an HTTP status + structured body. Never leaks an unknown error's message. */
export function toStructuredError(err: unknown): { status: number; body: StructuredError } {
  if (err instanceof AppError) {
    return { status: err.httpStatus, body: { error: { code: err.code, message: err.message } } };
  }
  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/errors.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts test/errors.test.ts
git commit -m "feat: structured error model"
```

---

## Task 3: Meridian schemas (`src/meridian/schema.ts`)

Zod schemas for the Meridian envelope, strategy items, and asset entries. Lenient about
unknown keys (`.passthrough()`), strict about the fields the service consumes.

**Files:**
- Create: `src/meridian/schema.ts`
- Test: `test/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/schema.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/schema.test.ts`
Expected: FAIL — cannot find module `../src/meridian/schema`.

- [ ] **Step 3: Write the implementation**

```ts
// src/meridian/schema.ts
import { z } from 'zod';

/** A string that parses to a finite number, e.g. "4.0000". */
const numericString = z
  .string()
  .refine((s) => s.trim() !== '' && Number.isFinite(Number(s)), {
    message: 'expected a numeric string',
  });

export const lockTypeSchema = z
  .object({
    type: z.string(),
    payout_frequency: z.number().optional(),
    unbonding_period: z.number().optional(),
    exit_queue_period: z.number().optional(),
    duration_months: z.number().optional(),
    delayed_withdrawals: z.boolean().optional(),
  })
  .passthrough();

export const aprEstimateSchema = z
  .object({
    low: numericString,
    high: numericString.optional(),
  })
  .passthrough();

export const autoCompoundSchema = z
  .object({
    type: z.string(),
    default: z.boolean().optional(),
  })
  .passthrough();

export const strategySchema = z
  .object({
    id: z.string(),
    asset: z.string(),
    lock_type: lockTypeSchema,
    apr_estimate: aprEstimateSchema.optional(),
    user_min_allocation: z.string(),
    auto_compound: autoCompoundSchema.optional(),
    yield_source: z.object({ type: z.string() }).passthrough().optional(),
    can_allocate: z.boolean().optional(),
  })
  .passthrough();

export const assetSchema = z
  .object({
    altname: z.string(),
    status: z.string(),
  })
  .passthrough();

export const strategiesEnvelopeSchema = z
  .object({
    error: z.array(z.string()),
    result: z.object({ items: z.array(strategySchema) }).passthrough(),
  })
  .passthrough();

export const assetsEnvelopeSchema = z
  .object({
    error: z.array(z.string()),
    result: z.record(assetSchema),
  })
  .passthrough();

export type RawLockType = z.infer<typeof lockTypeSchema>;
export type RawAprEstimate = z.infer<typeof aprEstimateSchema>;
export type RawAutoCompound = z.infer<typeof autoCompoundSchema>;
export type RawStrategy = z.infer<typeof strategySchema>;
export type RawAsset = z.infer<typeof assetSchema>;
export type AssetMap = Record<string, RawAsset>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/schema.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/meridian/schema.ts test/schema.test.ts
git commit -m "feat: Meridian envelope and strategy/asset schemas"
```

---

## Task 4: Meridian client interface (`src/meridian/client.ts`)

A type-only interface modelling the two Meridian Earn endpoints. No test — verified by `tsc`.

**Files:**
- Create: `src/meridian/client.ts`

- [ ] **Step 1: Write the implementation**

```ts
// src/meridian/client.ts
import type { RawStrategy, AssetMap } from './schema';

/**
 * Models the two Meridian Earn endpoints the service depends on.
 * The shipped implementation reads captured responses from disk; a production
 * implementation would call POST /private/Earn/Strategies and GET /public/Assets.
 */
export interface MeridianEarnClient {
  /** POST /private/Earn/Strategies — all earn strategies available to the account. */
  listStrategies(): Promise<RawStrategy[]>;
  /** GET /public/Assets — asset metadata, keyed by Meridian internal asset code. */
  listAssets(): Promise<AssetMap>;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/meridian/client.ts
git commit -m "feat: MeridianEarnClient interface"
```

---

## Task 5: File-backed mock client (`src/meridian/mock-client.ts`)

`FileMockMeridianClient` globs `data/`, treats each `*.json` file as a captured Meridian
response, classifies it by envelope shape, validates it, and merges. The result is cached
after the first read.

**Files:**
- Create: `src/meridian/mock-client.ts`
- Test: `test/mock-client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mock-client.test.ts`
Expected: FAIL — cannot find module `../src/meridian/mock-client`.

- [ ] **Step 3: Write the implementation**

```ts
// src/meridian/mock-client.ts
import { promises as fs } from 'fs';
import * as path from 'path';
import { ZodError } from 'zod';
import { AppError } from '../errors';
import {
  strategiesEnvelopeSchema,
  assetsEnvelopeSchema,
  type RawStrategy,
  type AssetMap,
} from './schema';
import type { MeridianEarnClient } from './client';

type Loaded = { strategies: RawStrategy[]; assets: AssetMap };
type Capture = 'strategies' | 'assets' | 'ignore';

/** Reads captured Meridian responses from a directory of JSON files. */
export class FileMockMeridianClient implements MeridianEarnClient {
  private cache: Loaded | undefined;

  constructor(private readonly dataDir: string) {}

  async listStrategies(): Promise<RawStrategy[]> {
    return (await this.load()).strategies;
  }

  async listAssets(): Promise<AssetMap> {
    return (await this.load()).assets;
  }

  private async load(): Promise<Loaded> {
    if (this.cache) return this.cache;

    let entries: string[];
    try {
      entries = await fs.readdir(this.dataDir);
    } catch {
      throw new AppError('DATA_UNAVAILABLE', `Data directory not found: ${this.dataDir}`);
    }

    const jsonFiles = entries.filter((f) => f.toLowerCase().endsWith('.json')).sort();
    if (jsonFiles.length === 0) {
      throw new AppError('DATA_UNAVAILABLE', `No JSON files found in ${this.dataDir}`);
    }

    const strategiesById = new Map<string, RawStrategy>();
    const assets: AssetMap = {};

    for (const file of jsonFiles) {
      const raw = await this.parseFile(file);
      assertNoUpstreamError(raw, file);

      const kind = classify(raw);
      if (kind === 'strategies') {
        const env = validate(strategiesEnvelopeSchema, raw, file);
        for (const s of env.result.items) strategiesById.set(s.id, s);
      } else if (kind === 'assets') {
        const env = validate(assetsEnvelopeSchema, raw, file);
        Object.assign(assets, env.result);
      }
      // kind === 'ignore' → skip
    }

    this.cache = { strategies: [...strategiesById.values()], assets };
    return this.cache;
  }

  private async parseFile(file: string): Promise<unknown> {
    const text = await fs.readFile(path.join(this.dataDir, file), 'utf8');
    try {
      return JSON.parse(text);
    } catch {
      throw new AppError('DATA_MALFORMED', `${file} is not valid JSON`);
    }
  }
}

/** A populated `error` array means the captured call failed upstream. */
function assertNoUpstreamError(raw: unknown, file: string): void {
  const errorField = (raw as { error?: unknown })?.error;
  if (Array.isArray(errorField) && errorField.length > 0) {
    throw new AppError(
      'DATA_UPSTREAM_ERROR',
      `${file} reports an upstream error: ${errorField.join(', ')}`,
    );
  }
}

function validate<T>(schema: { parse(d: unknown): T }, raw: unknown, file: string): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const where = issue ? `${issue.path.join('.')} — ${issue.message}` : 'schema mismatch';
      throw new AppError('DATA_MALFORMED', `${file} failed validation (${where})`);
    }
    throw err;
  }
}

/** Identifies which endpoint a capture came from, by envelope shape. */
function classify(raw: unknown): Capture {
  if (typeof raw !== 'object' || raw === null) return 'ignore';
  const result = (raw as { result?: unknown }).result;
  if (typeof result !== 'object' || result === null) return 'ignore';
  if (Array.isArray((result as { items?: unknown }).items)) return 'strategies';
  if (!Array.isArray(result) && isAssetsShape(result)) return 'assets';
  return 'ignore';
}

/** An assets result is a keyed object whose every value is an object with a string `altname`. */
function isAssetsShape(result: object): boolean {
  return Object.values(result).every(
    (v) =>
      typeof v === 'object' &&
      v !== null &&
      typeof (v as { altname?: unknown }).altname === 'string',
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/mock-client.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/meridian/mock-client.ts test/mock-client.test.ts
git commit -m "feat: file-backed mock Meridian client"
```

---

## Task 6: APR → APY conversion (`src/domain/apy.ts`)

Pure functions. `computeApy` returns the APY as a percentage number (unrounded), or `null`
when the strategy has no `apr_estimate`.

**Files:**
- Create: `src/domain/apy.ts`
- Test: `test/apy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/apy.test.ts
import { describe, it, expect } from 'vitest';
import { isCompounding, compoundingPeriodsPerYear, computeApy } from '../src/domain/apy';
import type { RawStrategy } from '../src/meridian/schema';

const base: RawStrategy = {
  id: 'S',
  asset: 'XETH',
  lock_type: { type: 'instant', payout_frequency: 604800 },
  apr_estimate: { low: '8.0000', high: '12.0000' },
  user_min_allocation: '0.01',
  auto_compound: { type: 'enabled' },
  can_allocate: true,
};

describe('isCompounding', () => {
  it('is true for enabled', () => expect(isCompounding({ type: 'enabled' })).toBe(true));
  it('is false for disabled', () => expect(isCompounding({ type: 'disabled' })).toBe(false));
  it('follows default for optional', () => {
    expect(isCompounding({ type: 'optional', default: true })).toBe(true);
    expect(isCompounding({ type: 'optional', default: false })).toBe(false);
    expect(isCompounding({ type: 'optional' })).toBe(false);
  });
  it('is false for undefined or an unknown type', () => {
    expect(isCompounding(undefined)).toBe(false);
    expect(isCompounding({ type: 'mystery' })).toBe(false);
  });
});

describe('compoundingPeriodsPerYear', () => {
  it('maps payout frequencies (seconds) to period counts', () => {
    expect(compoundingPeriodsPerYear(604800)).toBe(52);
    expect(compoundingPeriodsPerYear(432000)).toBe(73);
    expect(compoundingPeriodsPerYear(2592000)).toBe(12);
  });
});

describe('computeApy', () => {
  it('returns null when apr_estimate is absent', () => {
    const { apr_estimate, ...noApr } = base;
    expect(computeApy(noApr as RawStrategy)).toBeNull();
  });

  it('compounds weekly when auto_compound is enabled', () => {
    expect(computeApy(base)).toBeCloseTo(8.32, 2);
  });

  it('returns APY = APR when auto_compound is disabled', () => {
    const s: RawStrategy = { ...base, apr_estimate: { low: '4.0000' }, auto_compound: { type: 'disabled' } };
    expect(computeApy(s)).toBeCloseTo(4.0, 5);
  });

  it('returns APY = APR when payout_frequency is absent (flex)', () => {
    const s: RawStrategy = { ...base, lock_type: { type: 'flex' }, apr_estimate: { low: '6.0000' } };
    expect(computeApy(s)).toBeCloseTo(6.0, 5);
  });

  it('returns APY = APR for optional auto_compound defaulting off', () => {
    const s: RawStrategy = {
      ...base,
      apr_estimate: { low: '9.5000' },
      auto_compound: { type: 'optional', default: false },
    };
    expect(computeApy(s)).toBeCloseTo(9.5, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/apy.test.ts`
Expected: FAIL — cannot find module `../src/domain/apy`.

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/apy.ts
import type { RawStrategy, RawAutoCompound } from '../meridian/schema';

const SECONDS_PER_YEAR = 31_536_000; // 365 days

/** Whether rewards effectively compound, per the auto_compound field. */
export function isCompounding(autoCompound: RawAutoCompound | undefined): boolean {
  if (!autoCompound) return false;
  if (autoCompound.type === 'enabled') return true;
  if (autoCompound.type === 'optional') return autoCompound.default === true;
  return false; // 'disabled', or any unknown type
}

/** Compounding periods per year, from a payout frequency in seconds. */
export function compoundingPeriodsPerYear(payoutFrequencySeconds: number): number {
  return Math.round(SECONDS_PER_YEAR / payoutFrequencySeconds);
}

/**
 * The strategy's APY as a percentage number (e.g. 8.32), unrounded.
 * Returns null when the strategy has no apr_estimate (the MINA case).
 *
 * APY = (1 + APR/n)^n - 1, gated on auto_compound. Falls back to APY = APR when
 * compounding is off or payout_frequency is absent/non-positive (n undeterminable).
 */
export function computeApy(strategy: RawStrategy): number | null {
  const apr = strategy.apr_estimate;
  if (!apr) return null;

  const aprFraction = Number(apr.low) / 100;
  const payoutFrequency = strategy.lock_type.payout_frequency;

  if (
    !isCompounding(strategy.auto_compound) ||
    payoutFrequency === undefined ||
    payoutFrequency <= 0
  ) {
    return aprFraction * 100;
  }

  const n = compoundingPeriodsPerYear(payoutFrequency);
  const apyFraction = Math.pow(1 + aprFraction / n, n) - 1;
  return apyFraction * 100;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/apy.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/apy.ts test/apy.test.ts
git commit -m "feat: APR to APY conversion"
```

---

## Task 7: Tier model (`src/domain/tiers.ts`)

Pure functions: lock-type → access model → eligible tiers, plus `parseTier` for the query
param.

**Files:**
- Create: `src/domain/tiers.ts`
- Test: `test/tiers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/tiers.test.ts
import { describe, it, expect } from 'vitest';
import { accessModel, eligibleTiers, parseTier } from '../src/domain/tiers';
import type { RawLockType } from '../src/meridian/schema';

const lock = (props: Record<string, unknown>): RawLockType => props as RawLockType;

describe('accessModel', () => {
  it('treats instant and flex as instant-access', () => {
    expect(accessModel(lock({ type: 'instant', payout_frequency: 604800 }))).toBe('instant-access');
    expect(accessModel(lock({ type: 'flex' }))).toBe('instant-access');
  });

  it('treats bonded, hybrid, and timed as restricted', () => {
    expect(accessModel(lock({ type: 'bonded', unbonding_period: 333615 }))).toBe('restricted');
    expect(accessModel(lock({ type: 'hybrid', unbonding_period: 99999, delayed_withdrawals: true }))).toBe('restricted');
    expect(accessModel(lock({ type: 'timed', duration_months: 3 }))).toBe('restricted');
  });

  it('treats an exit queue or delayed withdrawals as restricted regardless of type', () => {
    expect(accessModel(lock({ type: 'instant', exit_queue_period: 100 }))).toBe('restricted');
    expect(accessModel(lock({ type: 'instant', delayed_withdrawals: true }))).toBe('restricted');
  });

  it('does not treat a bonding period as a restricted-access signal', () => {
    expect(accessModel(lock({ type: 'instant', bonding_period: 172800, payout_frequency: 604800 }))).toBe('instant-access');
  });

  it('treats an unknown lock type as restricted (conservative default)', () => {
    expect(accessModel(lock({ type: 'quantum-vault' }))).toBe('restricted');
  });
});

describe('eligibleTiers', () => {
  it('gives instant-access strategies to all three tiers', () => {
    expect(eligibleTiers('instant-access')).toEqual(['Standard', 'Premium', 'Private']);
  });
  it('restricts the rest to Premium and Private', () => {
    expect(eligibleTiers('restricted')).toEqual(['Premium', 'Private']);
  });
});

describe('parseTier', () => {
  it('parses the three tiers case-insensitively', () => {
    expect(parseTier('standard')).toBe('Standard');
    expect(parseTier('PREMIUM')).toBe('Premium');
    expect(parseTier('  private ')).toBe('Private');
  });
  it('throws INVALID_TIER for anything else', () => {
    expect(() => parseTier('gold')).toThrowError(/tier must be one of/);
    expect(() => parseTier(undefined)).toThrowError(/tier must be one of/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tiers.test.ts`
Expected: FAIL — cannot find module `../src/domain/tiers`.

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/tiers.ts
import { AppError } from '../errors';
import type { RawLockType } from '../meridian/schema';

export type Tier = 'Standard' | 'Premium' | 'Private';
export type AccessModel = 'instant-access' | 'restricted';

const RESTRICTED_TYPES = new Set(['bonded', 'hybrid', 'timed']);
const INSTANT_TYPES = new Set(['instant', 'flex']);

/**
 * Classifies a lock type by withdrawal-side structural signals.
 * `bonding_period` is deliberately ignored — it delays when rewards start, not withdrawal.
 */
export function accessModel(lockType: RawLockType): AccessModel {
  const hasLockSignal =
    (lockType.unbonding_period ?? 0) > 0 ||
    (lockType.exit_queue_period ?? 0) > 0 ||
    lockType.delayed_withdrawals === true ||
    lockType.duration_months !== undefined ||
    RESTRICTED_TYPES.has(lockType.type);

  if (hasLockSignal) return 'restricted';
  if (INSTANT_TYPES.has(lockType.type)) return 'instant-access';
  return 'restricted'; // unknown type, no instant-access signal → conservative default
}

/** The Aurora customer tiers that may see a strategy with this access model. */
export function eligibleTiers(model: AccessModel): Tier[] {
  return model === 'instant-access'
    ? ['Standard', 'Premium', 'Private']
    : ['Premium', 'Private'];
}

/** Parses the ?tier query param (case-insensitive). Throws AppError(INVALID_TIER) if invalid. */
export function parseTier(raw: unknown): Tier {
  const normalised = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  switch (normalised) {
    case 'standard':
      return 'Standard';
    case 'premium':
      return 'Premium';
    case 'private':
      return 'Private';
    default:
      throw new AppError('INVALID_TIER', 'tier must be one of: standard, premium, private');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/tiers.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/tiers.ts test/tiers.test.ts
git commit -m "feat: tier eligibility model"
```

---

## Task 8: Strategy transform (`src/domain/transform.ts`)

Pure. `toProduct` turns one raw strategy into an `EarnProduct`, or `null` if filtered out;
it throws `AppError(DATA_MALFORMED)` for a dangling asset reference. Defines the `EarnProduct`
output type.

**Files:**
- Create: `src/domain/transform.ts`
- Test: `test/transform.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/transform.test.ts
import { describe, it, expect } from 'vitest';
import { toProduct, displayName } from '../src/domain/transform';
import type { RawStrategy, AssetMap } from '../src/meridian/schema';

const assets: AssetMap = {
  XETH: { altname: 'ETH', status: 'enabled' },
  SOL: { altname: 'SOL', status: 'enabled' },
  POL: { altname: 'MATIC', status: 'enabled' },
  DEAD: { altname: 'DEAD', status: 'disabled' },
};

const strat = (over: Partial<RawStrategy> & Pick<RawStrategy, 'id' | 'asset'>): RawStrategy => ({
  lock_type: { type: 'instant', payout_frequency: 604800 },
  apr_estimate: { low: '8.0000' },
  user_min_allocation: '0.01',
  auto_compound: { type: 'disabled' },
  can_allocate: true,
  ...over,
});

describe('displayName', () => {
  it('synthesises {altname} {lock} {yield}', () => {
    expect(
      displayName(strat({ id: 'S', asset: 'XETH', lock_type: { type: 'bonded' }, yield_source: { type: 'staking' } }), 'ETH'),
    ).toBe('ETH Bonded Staking');
    expect(
      displayName(strat({ id: 'S', asset: 'USDC', lock_type: { type: 'hybrid' }, yield_source: { type: 'defi' } }), 'USDC'),
    ).toBe('USDC DeFi Vault');
    expect(
      displayName(strat({ id: 'S', asset: 'POL', lock_type: { type: 'flex' }, yield_source: { type: 'staking' } }), 'MATIC'),
    ).toBe('MATIC Flexible Staking');
  });
});

describe('toProduct', () => {
  it('builds an EarnProduct for a qualifying strategy', () => {
    const p = toProduct(strat({ id: 'S1', asset: 'XETH', yield_source: { type: 'staking' } }), assets);
    expect(p).toEqual({
      strategyId: 'S1',
      asset: 'ETH',
      displayName: 'ETH Flexible Staking',
      lockType: 'instant',
      apyDisplay: '8.00%',
      apyValue: 8,
      eligibleTiers: ['Standard', 'Premium', 'Private'],
      minimumAmount: '0.01',
    });
  });

  it('resolves the asset altname (POL → MATIC)', () => {
    expect(toProduct(strat({ id: 'S', asset: 'POL' }), assets)?.asset).toBe('MATIC');
  });

  it('throws DATA_MALFORMED for an unknown asset code', () => {
    expect(() => toProduct(strat({ id: 'S', asset: 'NOPE' }), assets)).toThrowError(/unknown asset code/);
  });

  it('drops a strategy with can_allocate:false', () => {
    expect(toProduct(strat({ id: 'S', asset: 'XETH', can_allocate: false }), assets)).toBeNull();
  });

  it('drops a strategy whose asset is not enabled', () => {
    expect(toProduct(strat({ id: 'S', asset: 'DEAD' }), assets)).toBeNull();
  });

  it('drops a strategy with APY below 3%', () => {
    expect(toProduct(strat({ id: 'S', asset: 'XETH', apr_estimate: { low: '2.5000' } }), assets)).toBeNull();
  });

  it('drops a strategy with no apr_estimate', () => {
    const { apr_estimate, ...noApr } = strat({ id: 'S', asset: 'XETH' });
    expect(toProduct(noApr as RawStrategy, assets)).toBeNull();
  });

  it('includes a strategy exactly on the 3% threshold', () => {
    const p = toProduct(
      strat({ id: 'S', asset: 'XETH', apr_estimate: { low: '3.0000' }, lock_type: { type: 'flex' } }),
      assets,
    );
    expect(p?.apyValue).toBe(3);
  });

  it('sets eligibleTiers to Premium/Private for a bonded strategy', () => {
    const p = toProduct(
      strat({ id: 'S', asset: 'SOL', lock_type: { type: 'bonded', unbonding_period: 100 } }),
      assets,
    );
    expect(p?.eligibleTiers).toEqual(['Premium', 'Private']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/transform.test.ts`
Expected: FAIL — cannot find module `../src/domain/transform`.

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/transform.ts
import { AppError } from '../errors';
import type { RawStrategy, AssetMap } from '../meridian/schema';
import { computeApy } from './apy';
import { accessModel, eligibleTiers, type Tier } from './tiers';

const APY_THRESHOLD = 3; // percent

/** The customer-facing earn product — the service's output shape. */
export interface EarnProduct {
  strategyId: string;
  asset: string;
  displayName: string;
  lockType: string;
  apyDisplay: string;
  apyValue: number;
  eligibleTiers: Tier[];
  minimumAmount: string;
}

const LOCK_WORD: Record<string, string> = {
  instant: 'Flexible',
  flex: 'Flexible',
  bonded: 'Bonded',
  timed: 'Fixed-Term',
};

const YIELD_WORD: Record<string, string> = {
  staking: 'Staking',
  defi: 'DeFi Vault',
  opt_in_rewards: 'Rewards',
};

/** Synthesises a customer-facing product name — the source data carries no name field. */
export function displayName(strategy: RawStrategy, altname: string): string {
  const lockWord = LOCK_WORD[strategy.lock_type.type] ?? '';
  const yieldWord = YIELD_WORD[strategy.yield_source?.type ?? ''] ?? 'Earn';
  return [altname, lockWord, yieldWord].filter((w) => w !== '').join(' ');
}

/**
 * Transforms one raw strategy into an EarnProduct, or null if it is filtered out
 * (can_allocate:false, non-enabled asset, or APY below 3% / absent).
 * Throws AppError(DATA_MALFORMED) if the strategy references an unknown asset code.
 */
export function toProduct(strategy: RawStrategy, assets: AssetMap): EarnProduct | null {
  // 1. Resolve the asset — a dangling reference is malformed data.
  const asset = assets[strategy.asset];
  if (!asset) {
    throw new AppError(
      'DATA_MALFORMED',
      `Strategy ${strategy.id} references unknown asset code "${strategy.asset}"`,
    );
  }

  // 2. Availability filter — the account cannot allocate.
  if (strategy.can_allocate === false) return null;

  // 3. Asset-status filter — the asset is not operational platform-wide.
  if (asset.status !== 'enabled') return null;

  // 4 & 5. APY + the hard ≥3% filter, on the unrounded value.
  const apyExact = computeApy(strategy);
  if (apyExact === null || apyExact < APY_THRESHOLD) return null;

  // 6 & 7. Build the output object (apyValue rounded to 2 decimals for display).
  const apyValue = Math.round(apyExact * 100) / 100;
  return {
    strategyId: strategy.id,
    asset: asset.altname,
    displayName: displayName(strategy, asset.altname),
    lockType: strategy.lock_type.type,
    apyDisplay: `${apyValue.toFixed(2)}%`,
    apyValue,
    eligibleTiers: eligibleTiers(accessModel(strategy.lock_type)),
    minimumAmount: strategy.user_min_allocation,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/transform.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/transform.ts test/transform.test.ts
git commit -m "feat: strategy-to-earn-product transform"
```

---

## Task 9: Earn products orchestrator (`src/domain/earn-products.ts`)

Loads strategies + assets from the client, transforms and filters them, filters to the
requested tier, and sorts by APY descending (strategyId ascending breaks ties).

**Files:**
- Create: `src/domain/earn-products.ts`
- Test: `test/earn-products-service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/earn-products-service.test.ts
import { describe, it, expect } from 'vitest';
import { getEarnProducts } from '../src/domain/earn-products';
import type { MeridianEarnClient } from '../src/meridian/client';
import type { RawStrategy, AssetMap } from '../src/meridian/schema';

const assets: AssetMap = {
  XETH: { altname: 'ETH', status: 'enabled' },
  SOL: { altname: 'SOL', status: 'enabled' },
  POL: { altname: 'MATIC', status: 'enabled' },
};

const instant = (id: string, asset: string, low: string): RawStrategy => ({
  id,
  asset,
  lock_type: { type: 'instant', payout_frequency: 604800 },
  apr_estimate: { low },
  user_min_allocation: '0',
  auto_compound: { type: 'disabled' },
  can_allocate: true,
});

const bonded = (id: string, asset: string, low: string): RawStrategy => ({
  id,
  asset,
  lock_type: { type: 'bonded', unbonding_period: 1000 },
  apr_estimate: { low },
  user_min_allocation: '0',
  auto_compound: { type: 'disabled' },
  can_allocate: true,
});

function fakeClient(strategies: RawStrategy[], assetMap: AssetMap = assets): MeridianEarnClient {
  return {
    listStrategies: async () => strategies,
    listAssets: async () => assetMap,
  };
}

describe('getEarnProducts', () => {
  it('returns instant-access products only for the Standard tier', async () => {
    const client = fakeClient([instant('S-INSTANT', 'XETH', '8.0000'), bonded('S-BONDED', 'SOL', '5.0000')]);
    const result = await getEarnProducts(client, 'Standard');
    expect(result.map((p) => p.strategyId)).toEqual(['S-INSTANT']);
  });

  it('returns all qualifying products for Premium and Private', async () => {
    const client = fakeClient([instant('S-INSTANT', 'XETH', '8.0000'), bonded('S-BONDED', 'SOL', '5.0000')]);
    expect((await getEarnProducts(client, 'Premium')).map((p) => p.strategyId)).toEqual(['S-INSTANT', 'S-BONDED']);
    expect(await getEarnProducts(client, 'Private')).toHaveLength(2);
  });

  it('sorts by APY descending', async () => {
    const client = fakeClient([
      instant('S-LOW', 'XETH', '4.0000'),
      instant('S-HIGH', 'SOL', '9.0000'),
      instant('S-MID', 'POL', '6.0000'),
    ]);
    expect((await getEarnProducts(client, 'Premium')).map((p) => p.apyValue)).toEqual([9, 6, 4]);
  });

  it('breaks APY ties by strategyId ascending', async () => {
    const client = fakeClient([instant('S-ZEBRA', 'XETH', '8.0000'), instant('S-ALPHA', 'SOL', '8.0000')]);
    expect((await getEarnProducts(client, 'Premium')).map((p) => p.strategyId)).toEqual(['S-ALPHA', 'S-ZEBRA']);
  });

  it('excludes sub-3% strategies', async () => {
    const client = fakeClient([instant('S-LOW', 'XETH', '2.0000')]);
    expect(await getEarnProducts(client, 'Premium')).toEqual([]);
  });

  it('propagates DATA_MALFORMED when a strategy references an unknown asset', async () => {
    const client = fakeClient([instant('S', 'GHOST', '8.0000')]);
    await expect(getEarnProducts(client, 'Premium')).rejects.toMatchObject({ code: 'DATA_MALFORMED' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/earn-products-service.test.ts`
Expected: FAIL — cannot find module `../src/domain/earn-products`.

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/earn-products.ts
import type { MeridianEarnClient } from '../meridian/client';
import { toProduct, type EarnProduct } from './transform';
import type { Tier } from './tiers';

/**
 * Loads strategies + assets via the client, transforms and filters them, then returns the
 * products visible to `tier`, sorted by APY descending (strategyId ascending breaks ties).
 */
export async function getEarnProducts(
  client: MeridianEarnClient,
  tier: Tier,
): Promise<EarnProduct[]> {
  const [strategies, assets] = await Promise.all([client.listStrategies(), client.listAssets()]);

  const products: EarnProduct[] = [];
  for (const strategy of strategies) {
    const product = toProduct(strategy, assets);
    if (product) products.push(product);
  }

  return products
    .filter((p) => p.eligibleTiers.includes(tier))
    .sort((a, b) => b.apyValue - a.apyValue || a.strategyId.localeCompare(b.strategyId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/earn-products-service.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/earn-products.ts test/earn-products-service.test.ts
git commit -m "feat: earn products orchestrator"
```

---

## Task 10: Configuration (`src/config.ts`)

Resolves `DATA_DIR` and `PORT`. Defaults work with no env vars set (the hard constraint).

**Files:**
- Create: `src/config.ts`

- [ ] **Step 1: Write the implementation**

```ts
// src/config.ts
import * as path from 'path';

/** TCP port the HTTP server binds. Defaults to 3000 (the assessment's required port). */
export const PORT: number = Number(process.env.PORT) || 3000;

/**
 * Directory of Meridian capture files. Defaults to `<cwd>/data`; the Docker image sets
 * WORKDIR /app, so this resolves to /app/data, where docker-compose bind-mounts ./data.
 */
export const DATA_DIR: string = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: configuration defaults"
```

---

## Task 11: HTTP route and app (`src/routes/earn-products.ts`, `src/app.ts`)

The route handler validates `tier`, calls the orchestrator, and maps every error through
`toStructuredError` — no exception ever reaches the client. `createApp` wires it up. Tested
end-to-end with Supertest against a real `FileMockMeridianClient` over a temp directory.

**Files:**
- Create: `src/routes/earn-products.ts`
- Create: `src/app.ts`
- Test: `test/endpoint.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/endpoint.test.ts`
Expected: FAIL — cannot find module `../src/app`.

- [ ] **Step 3: Write the route handler**

```ts
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
```

- [ ] **Step 4: Write the app**

```ts
// src/app.ts
import express, { type Express } from 'express';
import type { MeridianEarnClient } from './meridian/client';
import { earnProductsHandler } from './routes/earn-products';

/** Builds the Express app wired to a Meridian client. */
export function createApp(client: MeridianEarnClient): Express {
  const app = express();
  app.get('/earn-products', earnProductsHandler(client));
  return app;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/endpoint.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 6: Commit**

```bash
git add src/routes/earn-products.ts src/app.ts test/endpoint.test.ts
git commit -m "feat: GET /earn-products HTTP endpoint"
```

---

## Task 12: Server bootstrap (`src/server.ts`)

Wires the real `FileMockMeridianClient` to the app and listens on `0.0.0.0:3000`. No automated
test — exercised by the full test run (Task 16) and the Docker smoke test (Task 13).

**Files:**
- Create: `src/server.ts`

- [ ] **Step 1: Write the implementation**

```ts
// src/server.ts
import { createApp } from './app';
import { FileMockMeridianClient } from './meridian/mock-client';
import { DATA_DIR, PORT } from './config';

const client = new FileMockMeridianClient(DATA_DIR);
const app = createApp(client);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`earn-products listening on http://0.0.0.0:${PORT} (data dir: ${DATA_DIR})`);
});
```

- [ ] **Step 2: Verify it compiles and the full build works**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0; `dist/server.js` exists.

- [ ] **Step 3: Smoke-test the server locally**

Run: `node dist/server.js &` then `sleep 1 && curl -s 'http://localhost:3000/earn-products?tier=premium'`
Expected: a JSON array of earn products. Then stop the server: `kill %1`.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat: server bootstrap"
```

---

## Task 13: Containerisation (`Dockerfile`, `docker-compose.yml`)

Multi-stage build; runtime image runs as non-root. Compose bind-mounts `./data` read-only,
uses only the default network, and needs no env vars.

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`

- [ ] **Step 1: Write the `Dockerfile`**

```dockerfile
# --- Build stage: compile TypeScript ---
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Runtime stage: production deps + compiled output only ---
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

- [ ] **Step 2: Write `docker-compose.yml`**

No `version:` key (obsolete in Compose v2), no `networks:` block (a custom network would
reject the submission), no env vars.

```yaml
services:
  earn-products:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data:ro
```

- [ ] **Step 3: Build and start the stack**

Run: `docker compose up --build -d`
Expected: image builds, container starts. (Compose v1 `docker-compose up --build -d` works
identically against this file.)

- [ ] **Step 4: Smoke-test all three tiers**

Run: `sleep 2 && curl -s 'http://localhost:3000/earn-products?tier=standard' && echo && curl -s 'http://localhost:3000/earn-products?tier=premium' && echo && curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3000/earn-products?tier=bogus'`
Expected: `standard` → JSON array `[{...}]` of instant-access products; `premium` → larger
JSON array; `bogus` → `400`.

- [ ] **Step 5: Verify against the provided data**

Run: `curl -s 'http://localhost:3000/earn-products?tier=premium' | npx --yes json -a strategyId apyValue 2>/dev/null || curl -s 'http://localhost:3000/earn-products?tier=premium'`
Expected: 5 products in APY-descending order — DOT (8.32), USDC (7.50), ETH (4.00),
ADA (3.04), POL (3.00). See spec §12.

- [ ] **Step 6: Stop the stack**

Run: `docker compose down`
Expected: container stops and is removed.

- [ ] **Step 7: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "feat: Docker multi-stage build and compose"
```

---

## Task 14: README (`README.md`)

The repo currently has a short assessment-package `README.md`. **Overwrite it** with the
content below — the submission's reviewer-facing README.

**Files:**
- Modify: `README.md` (overwrite)

- [ ] **Step 1: Overwrite `README.md` with this content**

````markdown
# Aurora Bank — Earn Products Service

A proof-of-concept HTTP service that surfaces Meridian Earn strategies to Aurora Bank's
customers, applying Aurora's business rules (APY threshold, tiered eligibility) and
returning a clean, sorted JSON array ready for Aurora's React Native app.

Built for the Solutions Engineering take-home assessment. See `ASSESSMENT.md` for the brief
and `solution-design-note.md` for the integration handoff.

## Running

```bash
docker-compose up
```

The service starts on `http://localhost:3000` — no env vars, credentials, or setup needed.

```bash
curl 'http://localhost:3000/earn-products?tier=standard'
curl 'http://localhost:3000/earn-products?tier=premium'
curl 'http://localhost:3000/earn-products?tier=private'
```

`tier` is required and must be `standard`, `premium`, or `private`. Each item:

```json
{
  "strategyId": "ESRFUO3-Q62XD-WIOIL7",
  "asset": "DOT",
  "displayName": "DOT Flexible Staking",
  "lockType": "instant",
  "apyDisplay": "8.32%",
  "apyValue": 8.32,
  "eligibleTiers": ["Standard", "Premium", "Private"],
  "minimumAmount": "0.01"
}
```

On bad input or unavailable/malformed data the service returns a structured error — never a
stack trace: `{ "error": { "code": "INVALID_TIER", "message": "..." } }`.

## Architecture

Three layers, so the business logic is isolated and unit-testable without I/O:

1. **Meridian API client** (`src/meridian/`) — a `MeridianEarnClient` interface modelling the two
   Meridian endpoints. `FileMockMeridianClient` *mocks* those calls, reading captured responses
   from `data/`. It is the only component that would change for a live integration: a
   production `HttpMeridianClient` would implement the same interface against
   `POST /private/Earn/Strategies` and `GET /public/Assets`.
2. **Domain** (`src/domain/`) — pure functions: APR→APY conversion, tier model,
   transform/filter, orchestration. No I/O.
3. **HTTP** (`src/routes/`, `src/app.ts`, `src/server.ts`) — a thin Express layer.

Every `*.json` file in `data/` is treated as a captured API response and classified by
envelope shape, so graders can add files freely.

## Key decisions

- **APY from `apr_estimate.low`.** Strategies carry an APR *range*, not an APY. We take the
  conservative floor — a compliance-driven bank should not present a rate the customer
  cannot reliably meet — and convert APR→APY with `APY = (1 + APR/n)^n − 1`, compounding
  only when `auto_compound` is effectively on.
- **Tier model by structural signal.** A strategy is instant-access (Standard-eligible) when
  its lock type has no unbonding period, exit queue, or fixed term — covering `instant` and
  `flex`. `bonded`/`hybrid`/`timed` are Premium/Private only.
- **`can_allocate: false` strategies are dropped.** The `/private/` response is account-
  scoped; if Aurora's account cannot allocate, customers cannot invest.
- **Fail-closed errors.** Any malformed/unavailable data yields a structured error object.

Full reasoning: `solution-design-note.md`.

## Dependencies

| Dependency | Purpose | Why it is safe |
|---|---|---|
| `express` | HTTP server and routing | Industry-standard, MIT-licensed, no native dependencies, maintained by the OpenJS Foundation. Used only to receive one local request. |
| `zod` | Runtime validation of the Meridian JSON, which drives the structured-error requirement | MIT-licensed, zero dependencies, no native code, no network or filesystem access. |

Dev-only: `typescript`, `tsx`, `vitest`, `supertest` — not present in the runtime image.

The service makes **no outbound network calls at runtime** — all data comes from `data/`.

## Known limitations

- **`flex` allocation model.** In Meridian's real product `flex` ("Meridian Rewards") is an
  account-wide toggle, not a per-strategy allocation. It is surfaced here as a normal
  catalog item; a production frontend would treat it differently.
- **Per-customer geography.** Meridian filters strategies by Aurora's *account* region; finer
  per-customer geo-eligibility would need the customer's country as an input.
- **`displayName` is synthesised** from asset + lock + yield-source words — the source data
  has no product-name field.
- **`apyDisplay`** uses a fixed `%` format; true per-locale formatting is a future step.
- No auth, rate limiting, caching, or observability — out of scope for a PoC. Data is read
  once and cached for the process lifetime.

## Development

```bash
npm install
npm test          # vitest — unit + endpoint tests
npm run build     # tsc → dist/
npm run dev       # tsx watch (local, reads ./data)
```
````

- [ ] **Step 2: Verify the file is valid Markdown and committed**

Run: `head -1 README.md`
Expected: `# Aurora Bank — Earn Products Service`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: submission README"
```

---

## Task 15: Solution design note (`solution-design-note.md`)

A one-page handoff for a **mid-level Aurora Bank backend engineer** — external audience, no
internal jargon, no assumed context.

**Files:**
- Create: `solution-design-note.md`

- [ ] **Step 1: Create `solution-design-note.md` with this content**

````markdown
# Solution Design Note — Earn Products Service

**Audience:** Aurora Bank backend engineering.
**Purpose:** hand off the proof-of-concept that exposes Meridian crypto earn products to
Aurora's customers, so your team can take it toward production.

## What was built

A small HTTP service with one endpoint:

```
GET /earn-products?tier={standard|premium|private}
```

It returns a JSON array of earn products — each with a display name, APY, lock type,
eligible customer tiers, and minimum amount — sorted by APY (highest first), ready for the
mobile app. Invalid input or bad source data returns a structured error object, never a
stack trace.

## Where the data comes from

Two Meridian Earn API calls, modelled behind one interface (`MeridianEarnClient`):

| Call | Purpose |
|---|---|
| `POST /private/Earn/Strategies` | The earn strategies — asset, lock type, reward rate, minimum amount. Authenticated; the response is scoped to *your* Meridian account. |
| `GET /public/Assets` | Asset metadata — used to turn Meridian's internal codes (`XETH`) into customer-facing names (`ETH`). |

The PoC ships a **mock** of these calls that reads saved responses from a `data/` folder.
To go live, implement `MeridianEarnClient` with a real HTTP client — **nothing else in the
service changes.**

## How a strategy becomes a product

1. **Resolve the asset name.** Meridian's `XETH` → `ETH` via the Assets data. (Watch out:
   `POL`'s display name is `MATIC` — codes and names are not interchangeable.)
2. **Work out the APY.** Meridian gives an *APR range* (`low`/`high`), not an APY. We take the
   conservative `low` and convert: `APY = (1 + APR/n)^n − 1`, where `n` is the number of
   compounding periods per year. We only compound when the strategy actually auto-compounds.
3. **Apply the filters** (a strategy must pass all of them):
   - APY is at least **3%** (Aurora compliance rule).
   - `can_allocate` is not `false` (your account can actually invest in it).
   - The asset is `enabled` on Meridian (not delisted/suspended).
4. **Decide tier visibility** (see below) and format the output.

## How the tier logic works

Aurora has three customer tiers. Visibility depends on whether a strategy is
**instant-access** (the customer can withdraw any time) or **locked**:

- **Standard** customers see **instant-access** strategies only.
- **Premium** and **Private** customers see **all** qualifying strategies.

A strategy is *locked* if it has an unbonding period, an exit queue, delayed withdrawals, or
a fixed term — otherwise it is instant-access. This is decided from the data's structure,
not just the lock-type label, so new Meridian lock types are handled safely.

## Known edge cases (already handled)

- A strategy with **no reward-rate data** is dropped (cannot show an APY we don't have).
- APR values that sit **exactly on 3%** are included (the threshold is "≥ 3%").
- Lock types beyond the documented `instant`/`bonded` (`flex`, `hybrid`, `timed`) are
  classified by their lock structure; unknown future types default to "locked".
- A strategy referencing an **unknown asset code**, a file with **malformed JSON**, or a
  Meridian response carrying an **error** all produce a structured error, not a crash.

## Suggested next steps toward production

- **Real API client.** Implement `MeridianEarnClient` over HTTPS with API-key auth, timeouts,
  retries, and pagination handling.
- **Caching & refresh.** Reward rates change; cache responses with a sensible TTL or a
  scheduled refresh rather than reading once at startup.
- **Per-customer geography.** Meridian filters strategies by *Aurora's account* region. If
  Aurora's customers span jurisdictions with different rules, pass the customer's country to
  the endpoint and filter against Aurora's own per-jurisdiction permissions.
- **`flex` products.** Meridian's `flex` ("Meridian Rewards") is an account-wide setting, not a
  per-strategy allocation — the app should present it differently from a normal product.
- **Localised display.** `apyDisplay` currently uses a fixed `4.25%` format; format per the
  customer's locale.
- **Hardening.** Add authentication, rate limiting, request logging, and metrics.
````

- [ ] **Step 2: Verify the file**

Run: `head -1 solution-design-note.md`
Expected: `# Solution Design Note — Earn Products Service`

- [ ] **Step 3: Commit**

```bash
git add solution-design-note.md
git commit -m "docs: solution design note"
```

---

## Task 16: Final verification and submission package

Verification only — no new source files. Confirms the submission satisfies every hard
constraint in `ASSESSMENT.md`.

**Files:**
- Create: `ai-transcript.md` (exported, not authored)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all 8 suites pass — `errors`, `schema`, `mock-client`, `apy`, `tiers`,
`transform`, `earn-products-service`, `endpoint`.

- [ ] **Step 2: Verify a clean build**

Run: `npm run build`
Expected: exits 0; `dist/server.js` exists.

- [ ] **Step 3: Confirm `docker-compose.yml` declares no custom network**

Run: `grep -q 'networks:' docker-compose.yml && echo 'FAIL: custom network present' || echo 'OK: default network only'`
Expected: `OK: default network only`.

- [ ] **Step 4: Full clean Docker run from the repo root**

Run: `docker compose down --rmi local 2>/dev/null; docker compose up --build -d && sleep 3`
Expected: image builds from scratch, container starts.

- [ ] **Step 5: Verify the endpoint against the provided data (spec §12)**

Run: `curl -s 'http://localhost:3000/earn-products?tier=premium'; echo; curl -s 'http://localhost:3000/earn-products?tier=standard'`
Expected:
- `premium` → 5 products in APY-descending order: DOT `8.32%`, USDC `7.50%`, ETH `4.00%`,
  ADA `3.04%`, POL `3.00%`.
- `standard` → 3 instant-access products: DOT `8.32%`, ADA `3.04%`, POL `3.00%`.

- [ ] **Step 6: Stop the stack**

Run: `docker compose down`
Expected: container removed.

- [ ] **Step 7: Export the AI transcript**

`ai-transcript.md` is a required deliverable. Export the full Claude Code conversation(s) —
the brainstorming session, this planning session, and the implementation session — and save
the combined transcript as `ai-transcript.md` at the repository root. This is a manual
export step (use the Claude Code session export); it cannot be automated by this plan.

- [ ] **Step 8: Confirm the submission package and commit**

Run: `ls Dockerfile docker-compose.yml README.md solution-design-note.md ai-transcript.md && git status --short`
Expected: all five deliverables exist alongside the service code; working tree clean after:

```bash
git add ai-transcript.md
git commit -m "docs: add AI conversation transcript"
```

---

## Definition of Done

- `docker-compose up` from the repo root starts the service on `http://localhost:3000` with
  no extra steps, env vars, or credentials.
- `GET /earn-products?tier={standard|premium|private}` returns an APY-descending JSON array;
  bad input or data returns a structured error object, never a stack trace.
- All test suites pass; `npm run build` is clean.
- Submission package present: service code, `Dockerfile`, `docker-compose.yml`, `README.md`,
  `solution-design-note.md`, `ai-transcript.md`.
