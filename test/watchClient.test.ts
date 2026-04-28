import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { StateStore } from "../src/stateStore.js";
import type { CodexReviewSignalClient } from "../src/types.js";
import { RefreshingWatchClient } from "../src/watchClient.js";
import { WatchService } from "../src/watchService.js";

class FakeCodexClient implements CodexReviewSignalClient {
  refreshCount = 0;
  failRefresh = false;

  async getPullRequest() {
    this.refreshCount += 1;
    if (this.failRefresh) {
      throw new Error("GitHub unavailable");
    }
    return { headSha: "sha-1" };
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
}

test("RefreshingWatchClient refreshes GitHub state before returning deltas", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-pr-watcher-"));
  const github = new FakeCodexClient();
  const client = new RefreshingWatchClient(new WatchService(new StateStore(join(dir, "watcher.json"))), github);
  await client.registerWatch({ repo: "owner/repo", prNumber: 7 });

  const delta = await client.getDelta("owner/repo", 7);

  assert.equal(github.refreshCount, 1);
  assert.equal(delta.watch.lastReviewRequestHeadSha, "sha-1");
});

test("RefreshingWatchClient returns persisted deltas when GitHub refresh fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-pr-watcher-"));
  const service = new WatchService(new StateStore(join(dir, "watcher.json")));
  const github = new FakeCodexClient();
  github.failRefresh = true;
  const client = new RefreshingWatchClient(service, github);
  await client.registerWatch({ repo: "owner/repo", prNumber: 7 });
  await service.ingestEvent({
    repo: "owner/repo",
    prNumber: 7,
    kind: "review_comment",
    action: "created",
    author: "codex-review-bot",
    body: "Persisted webhook feedback.",
  });

  const delta = await client.getDelta("owner/repo", 7);

  assert.equal(github.refreshCount, 1);
  assert.equal(delta.events.length, 1);
  assert.equal(delta.events[0].body, "Persisted webhook feedback.");
});
