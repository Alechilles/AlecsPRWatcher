import test from "node:test";
import assert from "node:assert/strict";
import { createMcpServer } from "../src/mcp.js";

test("createMcpServer defers default watcher connectivity until a tool call", () => {
  const previousApiUrl = process.env.CODEX_PR_WATCHER_API_URL;
  const previousApiToken = process.env.CODEX_PR_WATCHER_API_TOKEN;
  process.env.CODEX_PR_WATCHER_API_URL = "https://watcher.example.test";
  delete process.env.CODEX_PR_WATCHER_API_TOKEN;

  try {
    assert.doesNotThrow(() => createMcpServer());
  } finally {
    restoreEnv("CODEX_PR_WATCHER_API_URL", previousApiUrl);
    restoreEnv("CODEX_PR_WATCHER_API_TOKEN", previousApiToken);
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
