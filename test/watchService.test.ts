import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { StateStore } from "../src/stateStore.js";
import { WatchService } from "../src/watchService.js";

async function service() {
  const dir = await mkdtemp(join(tmpdir(), "codex-pr-watcher-"));
  return new WatchService(new StateStore(join(dir, "watcher.json")));
}

test("registerWatch creates a normalized active watch", async () => {
  const watches = await service();

  const watch = await watches.registerWatch({
    repo: "OpenAI/Example",
    prNumber: 12,
    branch: "feature/review-loop",
    workspace: "C:/repo",
    botLogin: "codex-review-bot",
  });

  assert.equal(watch.id, "openai/example#12");
  assert.equal(watch.status, "active");
  assert.equal(watch.policy.botLogin, "codex-review-bot");
  assert.equal(watch.cursor, 0);
});

test("registerWatch starts a fresh lifecycle when reviving a completed watch", async () => {
  const watches = await service();
  await watches.registerWatch({
    repo: "owner/repo",
    prNumber: 7,
    quietMinutes: 10,
    botLogin: "codex-review-bot",
  }, new Date("2026-04-26T12:00:00.000Z"));
  await watches.ingestEvent({
    repo: "owner/repo",
    prNumber: 7,
    kind: "review_submitted",
    author: "codex-review-bot",
    state: "approved",
    createdAt: "2026-04-26T12:01:00.000Z",
  });
  const completed = await watches.getDelta("owner/repo", 7, new Date("2026-04-26T12:15:00.000Z"));

  const revived = await watches.registerWatch({
    repo: "owner/repo",
    prNumber: 7,
    quietMinutes: 10,
    botLogin: "codex-review-bot",
  }, new Date("2026-04-26T12:30:00.000Z"));
  const delta = await watches.getDelta("owner/repo", 7, new Date("2026-04-26T12:35:00.000Z"));

  assert.equal(completed.completed, true);
  assert.equal(completed.completionReason, "bot_approved");
  assert.equal(revived.status, "active");
  assert.equal(revived.createdAt, "2026-04-26T12:30:00.000Z");
  assert.equal(revived.lastActivityAt, "2026-04-26T12:30:00.000Z");
  assert.equal(revived.completedAt, undefined);
  assert.equal(delta.completed, false);
});

test("registerWatch hides stale unhandled events when reviving a completed watch", async () => {
  const watches = await service();
  await watches.registerWatch({
    repo: "owner/repo",
    prNumber: 7,
    timeoutMinutes: 10,
  }, new Date("2026-04-26T12:00:00.000Z"));
  await watches.ingestEvent({
    repo: "owner/repo",
    prNumber: 7,
    kind: "review_comment",
    author: "codex-review-bot",
    body: "Old feedback from the previous cycle.",
    createdAt: "2026-04-26T12:01:00.000Z",
  });
  await watches.setStatus("owner/repo", "completed", 7, new Date("2026-04-26T12:15:00.000Z"));

  const revived = await watches.registerWatch({
    repo: "owner/repo",
    prNumber: 7,
    timeoutMinutes: 10,
  }, new Date("2026-04-26T12:30:00.000Z"));
  const delta = await watches.getDelta("owner/repo", 7, new Date("2026-04-26T12:35:00.000Z"));

  assert.equal(revived.cursor, 1);
  assert.equal(delta.events.length, 0);
  assert.equal(delta.completed, false);
});

test("ingestEvent records only events for registered watches and deduplicates deliveries", async () => {
  const watches = await service();
  await watches.registerWatch({ repo: "owner/repo", prNumber: 7 });

  const first = await watches.ingestEvent({
    repo: "owner/repo",
    prNumber: 7,
    githubDeliveryId: "delivery-1",
    kind: "review_comment",
    author: "codex-review-bot",
    body: "Please rename this.",
  });
  const duplicate = await watches.ingestEvent({
    repo: "owner/repo",
    prNumber: 7,
    githubDeliveryId: "delivery-1",
    kind: "review_comment",
    author: "codex-review-bot",
    body: "Please rename this.",
  });
  const ignored = await watches.ingestEvent({
    repo: "owner/repo",
    prNumber: 99,
    kind: "review_comment",
    author: "codex-review-bot",
  });

  assert.equal(first?.id, 1);
  assert.equal(duplicate?.id, 1);
  assert.equal(ignored, undefined);
});

test("getDelta returns new unhandled feedback and markHandled advances the cursor", async () => {
  const watches = await service();
  await watches.registerWatch({ repo: "owner/repo", prNumber: 7, completeOnQuiet: false });
  const event = await watches.ingestEvent({
    repo: "owner/repo",
    prNumber: 7,
    kind: "review_comment",
    author: "codex-review-bot",
    body: "Please simplify this.",
  });

  const before = await watches.getDelta("owner/repo", 7);
  await watches.markHandled("owner/repo", [event?.id ?? 0], 7);
  const after = await watches.getDelta("owner/repo", 7);

  assert.equal(before.events.length, 1);
  assert.equal(before.events[0].body, "Please simplify this.");
  assert.equal(after.events.length, 0);
  assert.equal(after.watch.cursor, 1);
});

test("markHandled ignores unknown event IDs when advancing the cursor", async () => {
  const watches = await service();
  await watches.registerWatch({ repo: "owner/repo", prNumber: 7, completeOnQuiet: false });
  await watches.ingestEvent({
    repo: "owner/repo",
    prNumber: 7,
    kind: "review_comment",
    author: "codex-review-bot",
    body: "Please keep this visible.",
  });

  const watch = await watches.markHandled("owner/repo", [999], 7);
  const delta = await watches.getDelta("owner/repo", 7);

  assert.equal(watch.cursor, 0);
  assert.equal(delta.events.length, 1);
  assert.equal(delta.events[0].body, "Please keep this visible.");
});

test("markHandled does not advance past lower unhandled events", async () => {
  const watches = await service();
  await watches.registerWatch({ repo: "owner/repo", prNumber: 7, completeOnQuiet: false });
  const first = await watches.ingestEvent({
    repo: "owner/repo",
    prNumber: 7,
    kind: "review_comment",
    author: "codex-review-bot",
    body: "Handle me later.",
  });
  const second = await watches.ingestEvent({
    repo: "owner/repo",
    prNumber: 7,
    kind: "review_comment",
    author: "codex-review-bot",
    body: "Handled first.",
  });

  const watch = await watches.markHandled("owner/repo", [second?.id ?? 0], 7);
  const delta = await watches.getDelta("owner/repo", 7);

  assert.equal(watch.cursor, 0);
  assert.equal(delta.events.length, 1);
  assert.equal(delta.events[0].id, first?.id);
});

test("bot approval completes the watch", async () => {
  const watches = await service();
  await watches.registerWatch({
    repo: "owner/repo",
    prNumber: 7,
    botLogin: "codex-review-bot",
  });

  await watches.ingestEvent({
    repo: "owner/repo",
    prNumber: 7,
    kind: "review_submitted",
    author: "codex-review-bot",
    state: "approved",
  });
  const delta = await watches.getDelta("owner/repo", 7);

  assert.equal(delta.completed, true);
  assert.equal(delta.completionReason, "bot_approved");
});

test("quiet period completes only when feedback is handled", async () => {
  const watches = await service();
  const start = new Date("2026-04-26T12:00:00.000Z");
  await watches.registerWatch({
    repo: "owner/repo",
    prNumber: 7,
    quietMinutes: 10,
  }, start);
  const event = await watches.ingestEvent({
    repo: "owner/repo",
    prNumber: 7,
    kind: "review_comment",
    author: "codex-review-bot",
    body: "Please adjust this.",
    createdAt: "2026-04-26T12:01:00.000Z",
  });

  const withOpenFeedback = await watches.getDelta("owner/repo", 7, new Date("2026-04-26T12:20:00.000Z"));
  await watches.markHandled("owner/repo", [event?.id ?? 0], 7, new Date("2026-04-26T12:20:00.000Z"));
  const completed = await watches.getDelta("owner/repo", 7, new Date("2026-04-26T12:31:00.000Z"));

  assert.equal(withOpenFeedback.completed, false);
  assert.equal(completed.completed, true);
  assert.equal(completed.completionReason, "quiet_period");
});

test("quiet period ignores watcher-generated Codex review trigger comments", async () => {
  const watches = await service();
  const start = new Date("2026-04-26T12:00:00.000Z");
  await watches.registerWatch({
    repo: "owner/repo",
    prNumber: 7,
    quietMinutes: 10,
  }, start);
  await watches.ingestEvent({
    repo: "owner/repo",
    prNumber: 7,
    kind: "issue_comment",
    author: "Alechilles",
    body: "@codex review",
    createdAt: "2026-04-26T12:01:00.000Z",
  });

  const completed = await watches.getDelta("owner/repo", 7, new Date("2026-04-26T12:20:00.000Z"));

  assert.equal(completed.completed, true);
  assert.equal(completed.completionReason, "quiet_period");
});

test("quiet period waits for unhandled non-approval review submissions", async () => {
  const watches = await service();
  const start = new Date("2026-04-26T12:00:00.000Z");
  await watches.registerWatch({
    repo: "owner/repo",
    prNumber: 7,
    quietMinutes: 10,
  }, start);
  const event = await watches.ingestEvent({
    repo: "owner/repo",
    prNumber: 7,
    kind: "review_submitted",
    author: "codex-review-bot",
    state: "changes_requested",
    body: "Please address the review summary.",
    createdAt: "2026-04-26T12:01:00.000Z",
  });

  const withOpenReview = await watches.getDelta("owner/repo", 7, new Date("2026-04-26T12:20:00.000Z"));
  await watches.markHandled("owner/repo", [event?.id ?? 0], 7, new Date("2026-04-26T12:20:00.000Z"));
  const completed = await watches.getDelta("owner/repo", 7, new Date("2026-04-26T12:31:00.000Z"));

  assert.equal(withOpenReview.completed, false);
  assert.equal(completed.completed, true);
  assert.equal(completed.completionReason, "quiet_period");
});

test("quiet period ignores deleted review comments and dismissed reviews", async () => {
  const watches = await service();
  const start = new Date("2026-04-26T12:00:00.000Z");
  await watches.registerWatch({
    repo: "owner/repo",
    prNumber: 7,
    quietMinutes: 10,
  }, start);
  await watches.ingestEvent({
    repo: "owner/repo",
    prNumber: 7,
    kind: "review_comment",
    action: "deleted",
    author: "codex-review-bot",
    body: "Deleted inline feedback.",
    createdAt: "2026-04-26T12:01:00.000Z",
  });
  await watches.ingestEvent({
    repo: "owner/repo",
    prNumber: 7,
    kind: "review_submitted",
    action: "dismissed",
    author: "codex-review-bot",
    state: "changes_requested",
    body: "Dismissed review summary.",
    createdAt: "2026-04-26T12:02:00.000Z",
  });

  const completed = await watches.getDelta("owner/repo", 7, new Date("2026-04-26T12:20:00.000Z"));

  assert.equal(completed.completed, true);
  assert.equal(completed.completionReason, "quiet_period");
});
