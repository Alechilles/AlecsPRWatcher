import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { StateStore } from "../src/stateStore.js";
import type { CodexReviewSignalClient } from "../src/types.js";
import { WatchService } from "../src/watchService.js";

class FakeCodexClient implements CodexReviewSignalClient {
  headSha = "sha-1";
  reactions: Awaited<ReturnType<CodexReviewSignalClient["listIssueReactions"]>> = [];
  reviews: Awaited<ReturnType<CodexReviewSignalClient["listPullRequestReviews"]>> = [];
  comments: string[] = [];

  async getPullRequest() {
    return { headSha: this.headSha };
  }

  async listIssueReactions() {
    return this.reactions;
  }

  async listPullRequestReviews() {
    return this.reviews;
  }

  async createIssueComment(_repo: string, _prNumber: number, body: string) {
    this.comments.push(body);
    return { url: `https://github.test/comment/${this.comments.length}` };
  }
}

async function service() {
  const dir = await mkdtemp(join(tmpdir(), "codex-pr-watcher-"));
  return new WatchService(new StateStore(join(dir, "watcher.json")));
}

test("refreshCodexReviewState requests review once when Codex has not seen the head SHA", async () => {
  const watches = await service();
  const github = new FakeCodexClient();
  await watches.registerWatch({
    repo: "owner/repo",
    prNumber: 7,
    botLogin: "chatgpt-codex-connector[bot]",
  }, new Date("2026-04-27T12:00:00.000Z"));

  const first = await watches.refreshCodexReviewState("owner/repo", github, 7, new Date("2026-04-27T12:01:00.000Z"));
  const second = await watches.refreshCodexReviewState("owner/repo", github, 7, new Date("2026-04-27T12:02:00.000Z"));

  assert.equal(github.comments.length, 1);
  assert.equal(github.comments[0], "@codex review");
  assert.equal(first.lastReviewRequestHeadSha, "sha-1");
  assert.equal(second.lastReviewRequestHeadSha, "sha-1");
});

test("refreshCodexReviewState requests review again when the head SHA changes", async () => {
  const watches = await service();
  const github = new FakeCodexClient();
  await watches.registerWatch({ repo: "owner/repo", prNumber: 7 }, new Date("2026-04-27T12:00:00.000Z"));
  await watches.refreshCodexReviewState("owner/repo", github, 7, new Date("2026-04-27T12:01:00.000Z"));

  github.headSha = "sha-2";
  await watches.refreshCodexReviewState("owner/repo", github, 7, new Date("2026-04-27T12:03:00.000Z"));

  assert.deepEqual(github.comments, ["@codex review", "@codex review"]);
});

test("refreshCodexReviewState treats Codex eyes reaction as seen", async () => {
  const watches = await service();
  const github = new FakeCodexClient();
  github.reactions = [
    {
      content: "eyes",
      userLogin: "chatgpt-codex-connector[bot]",
      createdAt: "2026-04-27T12:02:00.000Z",
    },
  ];
  await watches.registerWatch({ repo: "owner/repo", prNumber: 7 }, new Date("2026-04-27T12:00:00.000Z"));

  const watch = await watches.refreshCodexReviewState("owner/repo", github, 7, new Date("2026-04-27T12:01:00.000Z"));

  assert.equal(github.comments.length, 0);
  assert.equal(watch.codexReviewSeenHeadSha, "sha-1");
});

test("refreshCodexReviewState completes when Codex gives thumbs up after seeing the latest head", async () => {
  const watches = await service();
  const github = new FakeCodexClient();
  github.reactions = [
    {
      content: "+1",
      userLogin: "chatgpt-codex-connector[bot]",
      createdAt: "2026-04-27T12:02:00.000Z",
    },
  ];
  await watches.registerWatch({
    repo: "owner/repo",
    prNumber: 7,
    completeOnThumbsUp: true,
  }, new Date("2026-04-27T12:00:00.000Z"));

  const watch = await watches.refreshCodexReviewState("owner/repo", github, 7, new Date("2026-04-27T12:01:00.000Z"));

  assert.equal(github.comments.length, 0);
  assert.equal(watch.status, "completed");
  assert.equal(watch.completionReason, "bot_thumbs_up");
});
