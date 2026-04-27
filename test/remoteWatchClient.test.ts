import test from "node:test";
import assert from "node:assert/strict";
import { resolveApiUrl } from "../src/remoteWatchClient.js";

test("resolveApiUrl preserves path prefixes from CODEX_PR_WATCHER_API_URL", () => {
  const url = resolveApiUrl("https://example.com/codex-pr-watcher/", "/api/register");

  assert.equal(url.href, "https://example.com/codex-pr-watcher/api/register");
});

test("resolveApiUrl supports prefixed base URLs without a trailing slash", () => {
  const url = resolveApiUrl("https://example.com/codex-pr-watcher", "api/delta?repo=owner%2Frepo");

  assert.equal(url.href, "https://example.com/codex-pr-watcher/api/delta?repo=owner%2Frepo");
});
