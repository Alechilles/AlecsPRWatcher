import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { GitHubAppClient } from "./githubAppAuth.js";
import { RemoteWatchClient } from "./remoteWatchClient.js";
import { StateStore } from "./stateStore.js";
import { RefreshingWatchClient, type WatchClient } from "./watchClient.js";
import { WatchService } from "./watchService.js";

export function createMcpServer(service: WatchClient = createDefaultWatchClient()): McpServer {
  const server = new McpServer({
    name: "codex-pr-review-watcher",
    version: "0.1.0",
  });

  server.tool(
    "register_watch",
    "Register or refresh a GitHub PR review watch.",
    {
      repo: z.string().describe("GitHub repository in owner/name format."),
      prNumber: z.number().int().positive().describe("Pull request number."),
      branch: z.string().optional().describe("Local or remote PR branch name."),
      workspace: z.string().optional().describe("Local workspace path Codex should use when addressing feedback."),
      threadLabel: z.string().optional().describe("Human label for the Codex thread that owns the watch."),
      botLogin: z.string().optional().describe("GitHub login for the Codex review bot."),
      quietMinutes: z.number().int().positive().optional().describe("Minutes with no new open feedback before quiet completion."),
      timeoutMinutes: z.number().int().positive().optional().describe("Maximum watch age before timeout completion."),
      completeOnApproval: z.boolean().optional(),
      completeOnThumbsUp: z.boolean().optional(),
      completeOnQuiet: z.boolean().optional(),
    },
    async (input) => textResult(await service.registerWatch(input)),
  );

  server.tool(
    "get_review_delta",
    "Return unhandled review events for a registered PR watch.",
    {
      repo: z.string().describe("GitHub repository in owner/name format, or a watch id when prNumber is omitted."),
      prNumber: z.number().int().positive().optional().describe("Pull request number."),
    },
    async ({ repo, prNumber }) => textResult(await service.getDelta(repo, prNumber)),
  );

  server.tool(
    "mark_events_handled",
    "Mark review event IDs handled after Codex has addressed and pushed changes.",
    {
      repo: z.string().describe("GitHub repository in owner/name format, or a watch id when prNumber is omitted."),
      prNumber: z.number().int().positive().optional().describe("Pull request number."),
      eventIds: z.array(z.number().int().positive()).describe("Watcher event IDs that were addressed."),
    },
    async ({ repo, prNumber, eventIds }) => textResult(await service.markHandled(repo, eventIds, prNumber)),
  );

  server.tool(
    "watch_status",
    "Return the current status and pending delta for one PR watch.",
    {
      repo: z.string().describe("GitHub repository in owner/name format, or a watch id when prNumber is omitted."),
      prNumber: z.number().int().positive().optional().describe("Pull request number."),
    },
    async ({ repo, prNumber }) => textResult(await service.getDelta(repo, prNumber)),
  );

  server.tool(
    "list_watches",
    "List all registered PR watches.",
    {},
    async () => textResult(await service.listWatches()),
  );

  return server;
}

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}

function createDefaultWatchClient(): WatchClient {
  const apiUrl = process.env.CODEX_PR_WATCHER_API_URL;
  const apiToken = process.env.CODEX_PR_WATCHER_API_TOKEN;
  if (apiUrl || apiToken) {
    if (!apiUrl || !apiToken) {
      throw new Error("CODEX_PR_WATCHER_API_URL and CODEX_PR_WATCHER_API_TOKEN must be set together");
    }
    return new RemoteWatchClient(apiUrl, apiToken, process.env.CODEX_PR_WATCHER_API_IP);
  }
  return new RefreshingWatchClient(new WatchService(new StateStore()), GitHubAppClient.fromEnvironment());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await startMcpServer();
}
