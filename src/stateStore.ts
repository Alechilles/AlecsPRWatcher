import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { WatchDatabase } from "./types.js";

export const DEFAULT_DB_PATH = ".codex-pr-watcher.json";
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 10000;
const STALE_LOCK_MS = 300000;

export function defaultDbPath(): string {
  return resolve(process.env.CODEX_PR_WATCHER_DB ?? DEFAULT_DB_PATH);
}

export function createEmptyDatabase(): WatchDatabase {
  return {
    version: 1,
    nextEventId: 1,
    watches: {},
    events: [],
    deliveries: {},
  };
}

export class StateStore {
  private pendingUpdate: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string = defaultDbPath()) {}

  get filePath(): string {
    return this.path;
  }

  async load(): Promise<WatchDatabase> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as WatchDatabase;
      if (parsed.version !== 1 || !parsed.watches || !Array.isArray(parsed.events)) {
        throw new Error(`Unsupported watcher database format at ${this.path}`);
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return createEmptyDatabase();
      }
      throw error;
    }
  }

  async save(db: WatchDatabase): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tempPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    const body = `${JSON.stringify(db, null, 2)}\n`;
    await writeFile(tempPath, body, "utf8");
    await rename(tempPath, this.path);
  }

  async update<T>(mutate: (db: WatchDatabase) => T | Promise<T>): Promise<T> {
    const run = this.pendingUpdate.then(async () => {
      return this.withFileLock(async () => {
        const db = await this.load();
        const result = await mutate(db);
        await this.save(db);
        return result;
      });
    });
    this.pendingUpdate = run.catch(() => undefined);
    return run;
  }

  private async withFileLock<T>(action: () => Promise<T>): Promise<T> {
    const release = await this.acquireFileLock();
    try {
      return await action();
    } finally {
      await release();
    }
  }

  private async acquireFileLock(): Promise<() => Promise<void>> {
    await mkdir(dirname(this.path), { recursive: true });
    const lockPath = `${this.path}.lock`;
    const deadline = Date.now() + LOCK_TIMEOUT_MS;

    while (true) {
      try {
        await mkdir(lockPath);
        return async () => {
          await rm(lockPath, { recursive: true, force: true });
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for watcher database lock at ${lockPath}`);
        }
        await removeStaleLock(lockPath);
        await sleep(LOCK_RETRY_MS);
      }
    }
  }
}

async function removeStaleLock(lockPath: string): Promise<void> {
  try {
    const lock = await stat(lockPath);
    if (Date.now() - lock.mtimeMs >= STALE_LOCK_MS) {
      await rm(lockPath, { recursive: true, force: true });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
