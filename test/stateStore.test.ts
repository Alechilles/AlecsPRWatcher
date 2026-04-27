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

test("StateStore serializes concurrent updates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-pr-watcher-"));
  const store = new StateStore(join(dir, "watcher.json"));

  await Promise.all(
    Array.from({ length: 20 }, async (_, index) => {
      await store.update(async (db) => {
        await new Promise((resolve) => setTimeout(resolve, index % 3));
        db.events.push({
          id: db.nextEventId++,
          watchId: "owner/repo#1",
          kind: "issue_comment",
          body: `event-${index}`,
          createdAt: new Date(0).toISOString(),
        });
      });
    }),
  );

  const reloaded = await store.load();
  const ids = reloaded.events.map((event) => event.id);

  assert.equal(reloaded.events.length, 20);
  assert.deepEqual(ids, Array.from({ length: 20 }, (_, index) => index + 1));
  assert.equal(reloaded.nextEventId, 21);
});
