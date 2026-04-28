import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { StateStore } from "../src/stateStore.js";
import { startServer } from "../src/server.js";
import { WatchService } from "../src/watchService.js";

test("delta API rejects invalid pr query values", async () => {
  const previousToken = process.env.WATCHER_API_TOKEN;
  process.env.WATCHER_API_TOKEN = "secret";
  const dir = await mkdtemp(join(tmpdir(), "codex-pr-watcher-"));
  const server = await startServer({
    port: 0,
    service: new WatchService(new StateStore(join(dir, "watcher.json"))),
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/delta?repo=owner/repo&pr=abc`, {
      headers: {
        authorization: "Bearer secret",
      },
    });
    const body = await response.json() as { error?: string };

    assert.equal(response.status, 400);
    assert.equal(body.error, "pr query parameter must be a positive integer");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    restoreEnv("WATCHER_API_TOKEN", previousToken);
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
