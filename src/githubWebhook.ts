import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { IngestEventInput } from "./types.js";

export interface ParsedWebhookEvent {
  eventName: string;
  deliveryId?: string;
  ingest?: IngestEventInput;
}

export function verifyGitHubSignature(rawBody: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const actualBuffer = Buffer.from(signatureHeader);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function parseGitHubWebhook(headers: IncomingHttpHeaders, rawBody: string): ParsedWebhookEvent {
  const eventName = headerValue(headers["x-github-event"]) ?? "unknown";
  const deliveryId = headerValue(headers["x-github-delivery"]);
  const payload = JSON.parse(rawBody) as Record<string, any>;
  const ingest = toIngestEvent(eventName, deliveryId, payload);
  return { eventName, deliveryId, ingest };
}

export function toIngestEvent(
  eventName: string,
  deliveryId: string | undefined,
  payload: Record<string, any>,
): IngestEventInput | undefined {
  const repo = payload.repository?.full_name;
  const prNumber =
    payload.pull_request?.number ??
    payload.issue?.pull_request?.url?.split("/").pop() ??
    payload.comment?.pull_request_url?.split("/").pop();

  if (!repo || !prNumber) {
    return undefined;
  }

  const numericPr = Number(prNumber);
  if (!Number.isInteger(numericPr) || numericPr < 1) {
    return undefined;
  }

  if (eventName === "pull_request_review_comment") {
    return {
      repo,
      prNumber: numericPr,
      githubDeliveryId: deliveryId,
      githubNodeId: payload.comment?.node_id,
      kind: "review_comment",
      action: payload.action,
      author: payload.comment?.user?.login,
      body: payload.comment?.body,
      url: payload.comment?.html_url,
      commitSha: payload.comment?.commit_id,
      rawEventName: eventName,
      createdAt: payload.comment?.created_at,
    };
  }

  if (eventName === "pull_request_review") {
    return {
      repo,
      prNumber: numericPr,
      githubDeliveryId: deliveryId,
      githubNodeId: payload.review?.node_id,
      kind: "review_submitted",
      action: payload.action,
      author: payload.review?.user?.login,
      body: payload.review?.body,
      url: payload.review?.html_url,
      state: payload.review?.state,
      commitSha: payload.review?.commit_id,
      rawEventName: eventName,
      createdAt: payload.review?.submitted_at,
    };
  }

  if (eventName === "issue_comment") {
    if (payload.action !== "created") {
      return undefined;
    }
    return {
      repo,
      prNumber: numericPr,
      githubDeliveryId: deliveryId,
      githubNodeId: payload.comment?.node_id,
      kind: "issue_comment",
      action: payload.action,
      author: payload.comment?.user?.login,
      body: payload.comment?.body,
      url: payload.comment?.html_url,
      rawEventName: eventName,
      createdAt: payload.comment?.created_at,
    };
  }

  if (eventName === "reaction") {
    return {
      repo,
      prNumber: numericPr,
      githubDeliveryId: deliveryId,
      githubNodeId: payload.reaction?.node_id,
      kind: "reaction",
      action: payload.action,
      author: payload.sender?.login ?? payload.reaction?.user?.login,
      reaction: payload.reaction?.content,
      url: payload.issue?.html_url ?? payload.comment?.html_url,
      rawEventName: eventName,
      createdAt: payload.reaction?.created_at,
    };
  }

  return undefined;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
