import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GitHubAppClient } from "./githubAppAuth.js";
import { parseGitHubWebhook, verifyGitHubSignature } from "./githubWebhook.js";
import { WatchService } from "./watchService.js";

const DEFAULT_PORT = 3797;

export interface ServerOptions {
  port?: number;
  webhookSecret?: string;
  service?: WatchService;
}

export async function startServer(options: ServerOptions = {}): Promise<Server> {
  const port = options.port ?? Number(process.env.PORT ?? DEFAULT_PORT);
  const webhookSecret = options.webhookSecret ?? process.env.GITHUB_WEBHOOK_SECRET;
  const apiToken = process.env.WATCHER_API_TOKEN;
  const githubApp = GitHubAppClient.fromEnvironment();
  const service = options.service ?? new WatchService();

  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/healthz") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.url?.startsWith("/api/")) {
        if (!apiToken) {
          sendJson(response, 503, { ok: false, error: "WATCHER_API_TOKEN is not configured" });
          return;
        }
        if (!isAuthorized(request, apiToken)) {
          sendJson(response, 401, { ok: false, error: "unauthorized" });
          return;
        }
        await handleApiRequest(request, response, service, githubApp);
        return;
      }

      if (request.method === "POST" && request.url === "/github/webhook") {
        const rawBody = await readRequestBody(request);
        if (webhookSecret) {
          const signature = request.headers["x-hub-signature-256"];
          const valid = verifyGitHubSignature(rawBody, Array.isArray(signature) ? signature[0] : signature, webhookSecret);
          if (!valid) {
            sendJson(response, 401, { ok: false, error: "invalid signature" });
            return;
          }
        }

        const parsed = parseGitHubWebhook(request.headers, rawBody);
        const event = parsed.ingest ? await service.ingestEvent(parsed.ingest) : undefined;
        sendJson(response, 202, {
          ok: true,
          eventName: parsed.eventName,
          deliveryId: parsed.deliveryId,
          stored: Boolean(event),
          eventId: event?.id,
        });
        return;
      }

      sendJson(response, 404, { ok: false, error: "not found" });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: (error as Error).message });
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(port, resolve);
  });

  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : port;
  console.error(`codex-pr-watcher listening on http://127.0.0.1:${resolvedPort}`);
  return server;
}

async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  service: WatchService,
  githubApp: GitHubAppClient | undefined,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/api/watches") {
    sendJson(response, 200, await service.listWatches());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/github-app") {
    if (!githubApp) {
      sendJson(response, 503, { ok: false, error: "GitHub App credentials are not configured" });
      return;
    }
    const [app, installations] = await Promise.all([githubApp.getApp(), githubApp.listInstallations()]);
    sendJson(response, 200, {
      app: {
        id: app.id,
        slug: app.slug,
        name: app.name,
        owner: app.owner?.login,
      },
      installations: installations.map((installation) => ({
        id: installation.id,
        account: installation.account?.login,
        repositorySelection: installation.repository_selection,
      })),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/register") {
    const body = JSON.parse(await readRequestBody(request));
    sendJson(response, 200, await service.registerWatch(body));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/delta") {
    const repo = url.searchParams.get("repo");
    const pr = url.searchParams.get("pr");
    if (!repo) {
      sendJson(response, 400, { ok: false, error: "repo query parameter is required" });
      return;
    }
    const prNumber = parseOptionalPrNumber(pr);
    if (pr !== null && prNumber === undefined) {
      sendJson(response, 400, { ok: false, error: "pr query parameter must be a positive integer" });
      return;
    }
    if (githubApp) {
      await service.refreshCodexReviewState(repo, githubApp, prNumber);
    }
    sendJson(response, 200, await service.getDelta(repo, prNumber));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/handled") {
    const body = JSON.parse(await readRequestBody(request)) as {
      repo?: string;
      prNumber?: number;
      eventIds?: number[];
    };
    if (!body.repo || !Array.isArray(body.eventIds)) {
      sendJson(response, 400, { ok: false, error: "repo and eventIds are required" });
      return;
    }
    sendJson(response, 200, await service.markHandled(body.repo, body.eventIds, body.prNumber));
    return;
  }

  sendJson(response, 404, { ok: false, error: "not found" });
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(body)}\n`);
}

export function parseOptionalPrNumber(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization;
  return header === `Bearer ${token}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await startServer();
}
