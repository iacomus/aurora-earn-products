// src/meridian/mock-client.ts
import { promises as fs } from "fs";
import * as path from "path";
import { ZodError } from "zod";
import { AppError } from "../errors";
import {
  strategiesEnvelopeSchema,
  assetsEnvelopeSchema,
  type RawStrategy,
  type AssetMap,
} from "./schema";
import type { MeridianEarnClient } from "./client";

type Loaded = { strategies: RawStrategy[]; assets: AssetMap };
type Capture = "strategies" | "assets" | "ignore";

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
      throw new AppError(
        "DATA_UNAVAILABLE",
        `Data directory not found: ${this.dataDir}`,
      );
    }

    const jsonFiles = entries
      .filter((f) => f.toLowerCase().endsWith(".json"))
      .sort();
    if (jsonFiles.length === 0) {
      throw new AppError(
        "DATA_UNAVAILABLE",
        `No JSON files found in ${this.dataDir}`,
      );
    }

    const strategiesById = new Map<string, RawStrategy>();
    const assets: AssetMap = {};

    for (const file of jsonFiles) {
      const raw = await this.parseFile(file);
      assertNoUpstreamError(raw, file);

      const kind = classify(raw);
      if (kind === "strategies") {
        const env = validate(strategiesEnvelopeSchema, raw, file);
        for (const s of env.result.items) strategiesById.set(s.id, s);
      } else if (kind === "assets") {
        const env = validate(assetsEnvelopeSchema, raw, file);
        Object.assign(assets, env.result);
      }
      // kind === 'ignore' → skip
    }

    this.cache = { strategies: [...strategiesById.values()], assets };
    return this.cache;
  }

  private async parseFile(file: string): Promise<unknown> {
    let text: string;
    try {
      text = await fs.readFile(path.join(this.dataDir, file), "utf8");
    } catch {
      throw new AppError("DATA_UNAVAILABLE", `Could not read ${file}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new AppError("DATA_MALFORMED", `${file} is not valid JSON`);
    }
  }
}

/** A populated `error` array means the captured call failed upstream. */
function assertNoUpstreamError(raw: unknown, file: string): void {
  const errorField = (raw as { error?: unknown })?.error;
  if (Array.isArray(errorField) && errorField.length > 0) {
    throw new AppError(
      "DATA_UPSTREAM_ERROR",
      `${file} reports an upstream error: ${errorField.join(", ")}`,
    );
  }
}

function validate<T>(
  schema: { parse(d: unknown): T },
  raw: unknown,
  file: string,
): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const where = issue
        ? `${issue.path.join(".")} — ${issue.message}`
        : "schema mismatch";
      throw new AppError(
        "DATA_MALFORMED",
        `${file} failed validation (${where})`,
      );
    }
    throw err;
  }
}

/** Identifies which endpoint a capture came from, by envelope shape. */
function classify(raw: unknown): Capture {
  if (typeof raw !== "object" || raw === null) return "ignore";
  const result = (raw as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) return "ignore";
  if (Array.isArray((result as { items?: unknown }).items)) return "strategies";
  if (!Array.isArray(result) && isAssetsShape(result)) return "assets";
  return "ignore";
}

/** Looks like an assets result: a non-empty keyed object with at least one asset-shaped value. */
function isAssetsShape(result: object): boolean {
  const values = Object.values(result);
  return (
    values.length > 0 &&
    values.some(
      (v) =>
        typeof v === "object" &&
        v !== null &&
        typeof (v as { altname?: unknown }).altname === "string",
    )
  );
}
