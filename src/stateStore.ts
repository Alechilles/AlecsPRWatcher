import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { WatchDatabase } from "./types.js";

export const DEFAULT_DB_PATH = ".codex-pr-watcher.json";

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
    const db = await this.load();
    const result = await mutate(db);
    await this.save(db);
    return result;
  }
}
