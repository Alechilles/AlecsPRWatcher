import { startMcpServer } from "./mcp.js";
import { RemoteWatchClient } from "./remoteWatchClient.js";
import { startServer } from "./server.js";
import { StateStore, defaultDbPath } from "./stateStore.js";
import { WatchService } from "./watchService.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface ParsedArgs {
  command: string;
  flags: Record<string, string | boolean>;
}

const usage = `codex-pr-watcher

Commands:
  register --repo owner/name --pr 123 [--branch branch] [--workspace path] [--bot codex-review-bot]
  delta --repo owner/name --pr 123
  handled --repo owner/name --pr 123 --events 1,2,3
  status --repo owner/name --pr 123
  list
  app
  prompt --repo owner/name --pr 123
  serve [--port 3797]
  mcp

Environment:
  CODEX_PR_WATCHER_DB       Path to watcher JSON database. Defaults to ./.codex-pr-watcher.json
  GITHUB_WEBHOOK_SECRET     Optional GitHub webhook secret for signature validation.
`;

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(argv);
  const service = createCliWatchClient();

  switch (parsed.command) {
    case "register": {
      const watch = await service.registerWatch({
        repo: requiredString(parsed, "repo"),
        prNumber: requiredNumber(parsed, "pr"),
        branch: optionalString(parsed, "branch"),
        workspace: optionalString(parsed, "workspace"),
        threadLabel: optionalString(parsed, "thread"),
        botLogin: optionalString(parsed, "bot"),
        quietMinutes: optionalNumber(parsed, "quiet-minutes"),
        timeoutMinutes: optionalNumber(parsed, "timeout-minutes"),
        completeOnApproval: optionalBoolean(parsed, "complete-on-approval"),
        completeOnThumbsUp: optionalBoolean(parsed, "complete-on-thumbs-up"),
        completeOnQuiet: optionalBoolean(parsed, "complete-on-quiet"),
      });
      printJson(watch);
      return;
    }
    case "delta":
    case "status": {
      const delta = await service.getDelta(requiredString(parsed, "repo"), requiredNumber(parsed, "pr"));
      printJson(delta);
      return;
    }
    case "handled": {
      const eventIds = requiredString(parsed, "events")
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0);
      const watch = await service.markHandled(requiredString(parsed, "repo"), eventIds, requiredNumber(parsed, "pr"));
      printJson(watch);
      return;
    }
    case "list": {
      printJson(await service.listWatches());
      return;
    }
    case "app": {
      printJson(await requestRemoteAppStatus());
      return;
    }
    case "prompt": {
      const repo = requiredString(parsed, "repo");
      const pr = requiredNumber(parsed, "pr");
      console.log(reviewPrompt(repo, pr));
      return;
    }
    case "serve": {
      await startServer({
        port: optionalNumber(parsed, "port"),
        service: new WatchService(new StateStore(defaultDbPath())),
      });
      return;
    }
    case "mcp": {
      await startMcpServer();
      return;
    }
    case "help":
    case "--help":
    case "-h":
    case "":
      console.log(usage);
      return;
    default:
      throw new Error(`Unknown command: ${parsed.command}\n\n${usage}`);
  }
}

async function requestRemoteAppStatus(): Promise<unknown> {
  const apiUrl = process.env.CODEX_PR_WATCHER_API_URL;
  const apiToken = process.env.CODEX_PR_WATCHER_API_TOKEN;
  const apiIp = process.env.CODEX_PR_WATCHER_API_IP;
  if (!apiUrl || !apiToken) {
    throw new Error("app command requires CODEX_PR_WATCHER_API_URL and CODEX_PR_WATCHER_API_TOKEN");
  }
  const client = new RemoteWatchClient(apiUrl, apiToken, apiIp);
  return client.rawGet("/api/github-app");
}

function createCliWatchClient(): Pick<WatchService, "registerWatch" | "getDelta" | "markHandled" | "listWatches"> {
  const apiUrl = process.env.CODEX_PR_WATCHER_API_URL;
  const apiToken = process.env.CODEX_PR_WATCHER_API_TOKEN;
  if (apiUrl || apiToken) {
    if (!apiUrl || !apiToken) {
      throw new Error("CODEX_PR_WATCHER_API_URL and CODEX_PR_WATCHER_API_TOKEN must be set together");
    }
    return new RemoteWatchClient(apiUrl, apiToken, process.env.CODEX_PR_WATCHER_API_IP);
  }
  return new WatchService(new StateStore(defaultDbPath()));
}

export function reviewPrompt(repo: string, prNumber: number): string {
  return `Check the PR review watcher for ${repo}#${prNumber}. If get_review_delta returns new review feedback, inspect the PR branch in the registered workspace, address only the new actionable comments, run the relevant tests, push the branch, reply to or resolve the addressed GitHub review threads when possible, then call mark_events_handled with the event IDs you addressed. If the watch is completed, summarize the completion reason and stop.`;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "", ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      index += 1;
    }
  }
  return { command, flags };
}

function requiredString(args: ParsedArgs, name: string): string {
  const value = args.flags[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required --${name}`);
  }
  return value;
}

function optionalString(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  return typeof value === "string" ? value : undefined;
}

function requiredNumber(args: ParsedArgs, name: string): number {
  const value = Number(requiredString(args, name));
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return value;
}

function optionalNumber(args: ParsedArgs, name: string): number | undefined {
  const value = args.flags[name];
  if (typeof value !== "string") {
    return undefined;
  }
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 1) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return numberValue;
}

function optionalBoolean(args: ParsedArgs, name: string): boolean | undefined {
  const value = args.flags[name];
  if (value === undefined) {
    return undefined;
  }
  if (value === true) {
    return true;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`--${name} must be true or false`);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
