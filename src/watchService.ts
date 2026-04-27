import type {
  CompletionReason,
  IngestEventInput,
  RegisterWatchInput,
  ReviewDelta,
  Watch,
  WatchDatabase,
  WatchEvent,
  WatchPolicy,
  WatchStatus,
} from "./types.js";
import { StateStore } from "./stateStore.js";

const DEFAULT_BOT_LOGIN = "codex";
const DEFAULT_QUIET_MINUTES = 15;
const DEFAULT_TIMEOUT_MINUTES = 240;

export class WatchService {
  constructor(private readonly store = new StateStore()) {}

  async registerWatch(input: RegisterWatchInput, now = new Date()): Promise<Watch> {
    const normalized = normalizeRegisterInput(input);
    return this.store.update((db) => {
      const id = watchId(normalized.repo, normalized.prNumber);
      const existing = db.watches[id];
      const timestamp = now.toISOString();
      const policy: WatchPolicy = {
        botLogin: normalized.botLogin ?? existing?.policy.botLogin ?? DEFAULT_BOT_LOGIN,
        quietMinutes: normalized.quietMinutes ?? existing?.policy.quietMinutes ?? DEFAULT_QUIET_MINUTES,
        timeoutMinutes: normalized.timeoutMinutes ?? existing?.policy.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES,
        completeOnApproval: normalized.completeOnApproval ?? existing?.policy.completeOnApproval ?? true,
        completeOnThumbsUp: normalized.completeOnThumbsUp ?? existing?.policy.completeOnThumbsUp ?? false,
        completeOnQuiet: normalized.completeOnQuiet ?? existing?.policy.completeOnQuiet ?? true,
      };

      const watch: Watch = {
        id,
        repo: normalized.repo,
        prNumber: normalized.prNumber,
        branch: normalized.branch ?? existing?.branch,
        workspace: normalized.workspace ?? existing?.workspace,
        threadLabel: normalized.threadLabel ?? existing?.threadLabel,
        status: "active",
        policy,
        cursor: existing?.cursor ?? 0,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        lastActivityAt: existing?.lastActivityAt ?? timestamp,
      };
      db.watches[id] = watch;
      return structuredClone(watch);
    });
  }

  async ingestEvent(input: IngestEventInput): Promise<WatchEvent | undefined> {
    const normalizedRepo = normalizeRepo(input.repo);
    return this.store.update((db) => {
      const id = watchId(normalizedRepo, input.prNumber);
      const watch = db.watches[id];
      if (!watch || watch.status === "paused") {
        return undefined;
      }

      if (input.githubDeliveryId && db.deliveries[input.githubDeliveryId]) {
        const existingId = db.deliveries[input.githubDeliveryId];
        return structuredClone(db.events.find((event) => event.id === existingId));
      }

      const now = input.createdAt ?? new Date().toISOString();
      const event: WatchEvent = {
        id: db.nextEventId++,
        watchId: id,
        githubDeliveryId: input.githubDeliveryId,
        githubNodeId: input.githubNodeId,
        kind: input.kind,
        action: input.action,
        author: input.author,
        body: input.body,
        url: input.url,
        state: input.state,
        reaction: input.reaction,
        commitSha: input.commitSha,
        rawEventName: input.rawEventName,
        createdAt: now,
      };

      db.events.push(event);
      if (input.githubDeliveryId) {
        db.deliveries[input.githubDeliveryId] = event.id;
      }

      watch.lastActivityAt = now;
      watch.updatedAt = now;
      updateCompletion(db, watch, new Date(now));
      return structuredClone(event);
    });
  }

  async getDelta(watchIdOrRepo: string, prNumber?: number, now = new Date()): Promise<ReviewDelta> {
    return this.store.update((db) => {
      const id = resolveWatchId(watchIdOrRepo, prNumber);
      const watch = db.watches[id];
      if (!watch) {
        throw new Error(`No watch registered for ${id}`);
      }
      updateCompletion(db, watch, now);
      const events = db.events
        .filter((event) => event.watchId === id)
        .filter((event) => event.id > watch.cursor)
        .filter((event) => !event.handledAt)
        .sort((left, right) => left.id - right.id);
      return {
        watch: structuredClone(watch),
        events: structuredClone(events),
        completed: watch.status === "completed",
        completionReason: watch.completionReason,
      };
    });
  }

  async markHandled(watchIdOrRepo: string, eventIds: number[], prNumber?: number, now = new Date()): Promise<Watch> {
    return this.store.update((db) => {
      const id = resolveWatchId(watchIdOrRepo, prNumber);
      const watch = db.watches[id];
      if (!watch) {
        throw new Error(`No watch registered for ${id}`);
      }

      const targetIds = new Set(eventIds);
      for (const event of db.events) {
        if (event.watchId === id && targetIds.has(event.id)) {
          event.handledAt = now.toISOString();
        }
      }

      if (eventIds.length > 0) {
        watch.cursor = Math.max(watch.cursor, ...eventIds);
      }
      watch.updatedAt = now.toISOString();
      updateCompletion(db, watch, now);
      return structuredClone(watch);
    });
  }

  async setStatus(watchIdOrRepo: string, status: WatchStatus, prNumber?: number, now = new Date()): Promise<Watch> {
    return this.store.update((db) => {
      const id = resolveWatchId(watchIdOrRepo, prNumber);
      const watch = db.watches[id];
      if (!watch) {
        throw new Error(`No watch registered for ${id}`);
      }
      watch.status = status;
      watch.updatedAt = now.toISOString();
      if (status !== "completed") {
        watch.completedAt = undefined;
        watch.completionReason = undefined;
      }
      return structuredClone(watch);
    });
  }

  async listWatches(now = new Date()): Promise<Watch[]> {
    return this.store.update((db) => {
      for (const watch of Object.values(db.watches)) {
        updateCompletion(db, watch, now);
      }
      return Object.values(db.watches)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((watch) => structuredClone(watch));
    });
  }
}

export function watchId(repo: string, prNumber: number): string {
  return `${normalizeRepo(repo)}#${prNumber}`;
}

function normalizeRegisterInput(input: RegisterWatchInput): RegisterWatchInput {
  if (!input.repo || !input.repo.includes("/")) {
    throw new Error("repo must use owner/name format");
  }
  if (!Number.isInteger(input.prNumber) || input.prNumber < 1) {
    throw new Error("prNumber must be a positive integer");
  }
  return {
    ...input,
    repo: normalizeRepo(input.repo),
  };
}

function normalizeRepo(repo: string): string {
  return repo.trim().toLowerCase();
}

function resolveWatchId(watchIdOrRepo: string, prNumber?: number): string {
  return prNumber === undefined ? watchIdOrRepo : watchId(watchIdOrRepo, prNumber);
}

function updateCompletion(db: WatchDatabase, watch: Watch, now: Date): void {
  if (watch.status !== "active") {
    return;
  }

  const reason = completionReason(db, watch, now);
  if (!reason) {
    return;
  }

  const timestamp = now.toISOString();
  watch.status = "completed";
  watch.completedAt = timestamp;
  watch.completionReason = reason;
  watch.updatedAt = timestamp;
}

function completionReason(db: WatchDatabase, watch: Watch, now: Date): CompletionReason | undefined {
  const events = db.events.filter((event) => event.watchId === watch.id);
  const botEvents = events.filter((event) => equalsLogin(event.author, watch.policy.botLogin));

  if (
    watch.policy.completeOnApproval &&
    botEvents.some((event) => event.kind === "review_submitted" && event.state?.toLowerCase() === "approved")
  ) {
    return "bot_approved";
  }

  if (
    watch.policy.completeOnThumbsUp &&
    botEvents.some((event) => event.kind === "reaction" && isThumbsUp(event.reaction))
  ) {
    return "bot_thumbs_up";
  }

  const ageMinutes = minutesBetween(new Date(watch.createdAt), now);
  if (ageMinutes >= watch.policy.timeoutMinutes) {
    return "timeout";
  }

  const quietMinutes = minutesBetween(new Date(watch.lastActivityAt), now);
  const openFeedback = events.some((event) => isFeedback(event) && !event.handledAt);
  if (watch.policy.completeOnQuiet && quietMinutes >= watch.policy.quietMinutes && !openFeedback) {
    return "quiet_period";
  }

  return undefined;
}

function isFeedback(event: WatchEvent): boolean {
  return event.kind === "review_comment" || event.kind === "issue_comment";
}

function isThumbsUp(reaction?: string): boolean {
  return reaction === "+1" || reaction?.toLowerCase() === "thumbs_up";
}

function equalsLogin(left: string | undefined, right: string): boolean {
  return left?.toLowerCase() === right.toLowerCase();
}

function minutesBetween(left: Date, right: Date): number {
  return (right.getTime() - left.getTime()) / 60000;
}
