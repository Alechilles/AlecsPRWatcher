import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { StateStore } from "../src/stateStore.js";

test("StateStore returns an empty database when no file exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-pr-watcher-"));
  const store = new StateStore(join(dir, "watcher.json"));

  const db = await store.load();

  assert.equal(db.version, 1);
  assert.equal(db.nextEventId, 1);
  assert.deepEqual(db.watches, {});
  assert.deepEqual(db.events, []);
});

test("StateStore persists updates atomically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-pr-watcher-"));
  const store = new StateStore(join(dir, "watcher.json"));

  await store.update((db) => {
    db.nextEventId = 42;
  });

  const raw = await readFile(store.filePath, "utf8");
  const reloaded = await store.load();

  assert.match(raw, /"nextEventId": 42/);
  assert.equal(reloaded.nextEventId, 42);
});
