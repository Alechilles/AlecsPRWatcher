import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { StateStore } from "../src/stateStore.js";
import { startServer, type ServerGitHubClient } from "../src/server.js";
import type { PullRequestSnapshot } from "../src/types.js";
import { WatchService } from "../src/watchService.js";

class FailingRefreshGitHubClient implements ServerGitHubClient {
  refreshCount = 0;

  async getPullRequest(): Promise<PullRequestSnapshot> {
    this.refreshCount += 1;
    throw new Error("GitHub unavailable");
  }

  async listIssueReactions() {
    return [];
  }

  async listPullRequestReviews() {
    return [];
  }

  async createIssueComment() {
    return {};
  }

  async getApp() {
    return { id: 1, slug: "test-app", name: "Test App" };
  }

  async listInstallations() {
    return [];
  }
}

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

test("delta API returns stored events when GitHub refresh fails", async () => {
  const previousToken = process.env.WATCHER_API_TOKEN;
  process.env.WATCHER_API_TOKEN = "secret";
  const dir = await mkdtemp(join(tmpdir(), "codex-pr-watcher-"));
  const service = new WatchService(new StateStore(join(dir, "watcher.json")));
  const githubApp = new FailingRefreshGitHubClient();
  await service.registerWatch({ repo: "owner/repo", prNumber: 7 });
  await service.ingestEvent({
    repo: "owner/repo",
    prNumber: 7,
    kind: "review_comment",
    action: "created",
    author: "codex-review-bot",
    body: "Persisted webhook feedback.",
  });
  const server = await startServer({
    port: 0,
    service,
    githubApp,
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/delta?repo=owner/repo&pr=7`, {
      headers: {
        authorization: "Bearer secret",
      },
    });
    const body = await response.json() as { events?: Array<{ body?: string }> };

    assert.equal(response.status, 200);
    assert.equal(githubApp.refreshCount, 1);
    assert.equal(body.events?.length, 1);
    assert.equal(body.events?.[0]?.body, "Persisted webhook feedback.");
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

test("API rejects oversized request bodies", async () => {
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
    const response = await fetch(`http://127.0.0.1:${address.port}/api/register`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        repo: "owner/repo",
        prNumber: 7,
        workspace: "x".repeat(1024 * 1024),
      }),
    });
    const body = await response.json() as { error?: string };

    assert.equal(response.status, 413);
    assert.equal(body.error, "request body is too large");
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
