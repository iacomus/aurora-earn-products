// src/config.ts
import * as path from 'path';

/** TCP port the HTTP server binds. Defaults to 3000 (the assessment's required port). */
export const PORT: number = Number(process.env.PORT) || 3000;

/**
 * Directory of Meridian capture files. Defaults to `<cwd>/data`; the Docker image sets
 * WORKDIR /app, so this resolves to /app/data, where docker-compose bind-mounts ./data.
 */
export const DATA_DIR: string = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
