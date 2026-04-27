import test from "node:test";
import assert from "node:assert/strict";
import { main } from "../src/cli.js";

test("help does not initialize watcher connectivity", async () => {
  const previousApiUrl = process.env.CODEX_PR_WATCHER_API_URL;
  const previousApiToken = process.env.CODEX_PR_WATCHER_API_TOKEN;
  const output: string[] = [];
  const previousLog = console.log;
  process.env.CODEX_PR_WATCHER_API_URL = "https://watcher.example.test";
  delete process.env.CODEX_PR_WATCHER_API_TOKEN;
  console.log = (value?: unknown) => {
    output.push(String(value));
  };

  try {
    await main(["help"]);
  } finally {
    console.log = previousLog;
    restoreEnv("CODEX_PR_WATCHER_API_URL", previousApiUrl);
    restoreEnv("CODEX_PR_WATCHER_API_TOKEN", previousApiToken);
  }

  assert.match(output.join("\n"), /codex-pr-watcher/);
});

test("prompt does not initialize watcher connectivity", async () => {
  const previousApiUrl = process.env.CODEX_PR_WATCHER_API_URL;
  const previousApiToken = process.env.CODEX_PR_WATCHER_API_TOKEN;
  const output: string[] = [];
  const previousLog = console.log;
  process.env.CODEX_PR_WATCHER_API_URL = "https://watcher.example.test";
  delete process.env.CODEX_PR_WATCHER_API_TOKEN;
  console.log = (value?: unknown) => {
    output.push(String(value));
  };

  try {
    await main(["prompt", "--repo", "owner/repo", "--pr", "7"]);
  } finally {
    console.log = previousLog;
    restoreEnv("CODEX_PR_WATCHER_API_URL", previousApiUrl);
    restoreEnv("CODEX_PR_WATCHER_API_TOKEN", previousApiToken);
  }

  assert.match(output.join("\n"), /owner\/repo#7/);
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
