import type {
  CompletionReason,
  CodexReviewSignalClient,
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

const DEFAULT_CODEX_REVIEW_BOT_LOGIN = "chatgpt-codex-connector[bot]";
const DEFAULT_BOT_LOGIN = DEFAULT_CODEX_REVIEW_BOT_LOGIN;
const DEFAULT_QUIET_MINUTES = 15;
const DEFAULT_TIMEOUT_MINUTES = 240;
const CODEX_REVIEW_TRIGGER_COMMENT = "@codex review";

export class WatchService {
  constructor(private readonly store = new StateStore()) {}

  async registerWatch(input: RegisterWatchInput, now = new Date()): Promise<Watch> {
    const normalized = normalizeRegisterInput(input);
    return this.store.update((db) => {
      const id = watchId(normalized.repo, normalized.prNumber);
      const existing = db.watches[id];
      const timestamp = now.toISOString();
      const startsNewCycle = existing?.status !== "active";
      const policy: WatchPolicy = {
        botLogin: normalized.botLogin ?? existing?.policy.botLogin ?? DEFAULT_BOT_LOGIN,
        quietMinutes: normalized.quietMinutes ?? existing?.policy.quietMinutes ?? DEFAULT_QUIET_MINUTES,
        timeoutMinutes: normalized.timeoutMinutes ?? existing?.policy.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES,
        completeOnApproval: normalized.completeOnApproval ?? existing?.policy.completeOnApproval ?? true,
        completeOnThumbsUp: normalized.completeOnThumbsUp ?? existing?.policy.completeOnThumbsUp ?? true,
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
        cursor: startsNewCycle ? lastEventIdForWatch(db, id) : existing?.cursor ?? 0,
        createdAt: startsNewCycle ? timestamp : existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        lastActivityAt: startsNewCycle ? timestamp : existing?.lastActivityAt ?? timestamp,
        lastObservedHeadSha: startsNewCycle ? undefined : existing?.lastObservedHeadSha,
        lastObservedHeadAt: startsNewCycle ? undefined : existing?.lastObservedHeadAt,
        lastReviewRequestHeadSha: startsNewCycle ? undefined : existing?.lastReviewRequestHeadSha,
        lastReviewRequestAt: startsNewCycle ? undefined : existing?.lastReviewRequestAt,
        codexReviewSeenHeadSha: startsNewCycle ? undefined : existing?.codexReviewSeenHeadSha,
        codexReviewSeenAt: startsNewCycle ? undefined : existing?.codexReviewSeenAt,
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

      if (event.kind === "head_changed" && event.commitSha) {
        watch.lastObservedHeadSha = event.commitSha;
        watch.lastObservedHeadAt = now;
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

  async refreshCodexReviewState(
    watchIdOrRepo: string,
    github: CodexReviewSignalClient,
    prNumber?: number,
    now = new Date(),
  ): Promise<Watch> {
    const id = resolveWatchId(watchIdOrRepo, prNumber);
    const current = await this.store.update((db) => {
      const watch = db.watches[id];
      if (!watch) {
        throw new Error(`No watch registered for ${id}`);
      }
      return structuredClone(watch);
    });
    if (current.status !== "active") {
      return current;
    }

    const [pullRequest, reactions, reviews] = await Promise.all([
      github.getPullRequest(current.repo, current.prNumber),
      github.listIssueReactions(current.repo, current.prNumber),
      github.listPullRequestReviews(current.repo, current.prNumber),
    ]);
    const timestamp = now.toISOString();
    const headChanged = current.lastObservedHeadSha !== pullRequest.headSha;
    const observedAt = headChanged
      ? current.lastObservedHeadSha === undefined
        ? current.createdAt
        : timestamp
      : current.lastObservedHeadAt ?? timestamp;
    const codexLogins = codexActorLogins(current);
    const codexReviews = reviews
      .filter((review) =>
        review.commitSha === pullRequest.headSha &&
        isCodexActor(review.author, codexLogins) &&
        isAtOrAfter(review.submittedAt, current.createdAt),
      )
      .sort((left, right) => timestampMillis(right.submittedAt) - timestampMillis(left.submittedAt));
    const codexReview = codexReviews.find((review) => review.state.toLowerCase() === "approved") ?? codexReviews[0];
    const codexReactions = reactions
      .filter((reaction) =>
        isCodexActor(reaction.userLogin, codexLogins) &&
        new Date(reaction.createdAt).getTime() >= new Date(observedAt).getTime() &&
        (reaction.content === "eyes" || isThumbsUp(reaction.content)),
      )
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    const codexReaction = codexReactions.find((reaction) => isThumbsUp(reaction.content)) ?? codexReactions[0];
    const thumbsUp = codexReaction && isThumbsUp(codexReaction.content);
    const approved = codexReview?.state.toLowerCase() === "approved";
    const seenAt = codexReaction?.createdAt ?? codexReview?.submittedAt ?? timestamp;

    if (codexReview || codexReaction) {
      return this.store.update((db) => {
        const watch = db.watches[id];
        if (!watch) {
          throw new Error(`No watch registered for ${id}`);
        }
        watch.lastObservedHeadSha = pullRequest.headSha;
        watch.lastObservedHeadAt = observedAt;
        watch.codexReviewSeenHeadSha = pullRequest.headSha;
        watch.codexReviewSeenAt = seenAt;
        watch.updatedAt = timestamp;
        if (approved && watch.policy.completeOnApproval && watch.status === "active") {
          watch.status = "completed";
          watch.completedAt = timestamp;
          watch.completionReason = "bot_approved";
        } else if (thumbsUp && watch.policy.completeOnThumbsUp && watch.status === "active") {
          watch.status = "completed";
          watch.completedAt = timestamp;
          watch.completionReason = "bot_thumbs_up";
        }
        return structuredClone(watch);
      });
    }

    const shouldRequestReview = current.lastReviewRequestHeadSha !== pullRequest.headSha;
    if (!shouldRequestReview) {
      return this.store.update((db) => {
        const watch = db.watches[id];
        if (!watch) {
          throw new Error(`No watch registered for ${id}`);
        }
        watch.lastObservedHeadSha = pullRequest.headSha;
        watch.lastObservedHeadAt = observedAt;
        watch.updatedAt = timestamp;
        return structuredClone(watch);
      });
    }

    const reserved = await this.store.update((db) => {
      const watch = db.watches[id];
      if (!watch) {
        throw new Error(`No watch registered for ${id}`);
      }
      if (watch.status !== "active") {
        return false;
      }
      if (watch.lastReviewRequestHeadSha === pullRequest.headSha) {
        return false;
      }
      watch.lastObservedHeadSha = pullRequest.headSha;
      watch.lastObservedHeadAt = observedAt;
      watch.lastReviewRequestHeadSha = pullRequest.headSha;
      watch.lastReviewRequestAt = timestamp;
      watch.updatedAt = timestamp;
      return true;
    });

    if (reserved) {
      try {
        await github.createIssueComment(current.repo, current.prNumber, CODEX_REVIEW_TRIGGER_COMMENT);
      } catch (error) {
        await this.store.update((db) => {
          const watch = db.watches[id];
          if (watch?.lastReviewRequestHeadSha === pullRequest.headSha && watch.lastReviewRequestAt === timestamp) {
            watch.lastReviewRequestHeadSha = undefined;
            watch.lastReviewRequestAt = undefined;
            watch.updatedAt = new Date().toISOString();
          }
          return undefined;
        });
        throw error;
      }
    }

    return this.store.update((db) => {
      const watch = db.watches[id];
      if (!watch) {
        throw new Error(`No watch registered for ${id}`);
      }
      return structuredClone(watch);
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

      watch.cursor = nextCursor(db, watch);
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
  const events = db.events.filter((event) => event.watchId === watch.id && isInCurrentCycle(event, watch));
  const botEvents = events.filter((event) => equalsLogin(event.author, watch.policy.botLogin));

  if (
    watch.policy.completeOnApproval &&
    botEvents.some((event) => event.kind === "review_submitted" && event.state?.toLowerCase() === "approved")
  ) {
    return "bot_approved";
  }

  if (
    watch.policy.completeOnThumbsUp &&
    botEvents.some((event) => event.kind === "reaction" && event.action === "created" && isThumbsUp(event.reaction))
  ) {
    return "bot_thumbs_up";
  }

  const ageMinutes = minutesBetween(new Date(watch.createdAt), now);
  if (ageMinutes >= watch.policy.timeoutMinutes) {
    return "timeout";
  }

  const quietMinutes = minutesBetween(new Date(watch.lastActivityAt), now);
  const openFeedback = hasOpenFeedback(events);
  if (watch.policy.completeOnQuiet && quietMinutes >= watch.policy.quietMinutes && !openFeedback) {
    return "quiet_period";
  }

  return undefined;
}

function hasOpenFeedback(events: WatchEvent[]): boolean {
  const latestFeedbackEvents = new Map<string, WatchEvent>();
  for (const event of events) {
    if (!isFeedbackLifecycleEvent(event)) {
      continue;
    }

    const key = feedbackEventKey(event);
    const existing = latestFeedbackEvents.get(key);
    if (!existing || isFresherEvent(event, existing)) {
      latestFeedbackEvents.set(key, event);
    }
  }

  return Array.from(latestFeedbackEvents.values()).some((event) => isFeedback(event) && !event.handledAt);
}

function isFeedbackLifecycleEvent(event: WatchEvent): boolean {
  return (
    event.kind === "review_thread" ||
    event.kind === "review_comment" ||
    event.kind === "review_submitted" ||
    event.kind === "issue_comment"
  );
}

function feedbackEventKey(event: WatchEvent): string {
  return `${event.kind}:${event.githubNodeId ?? event.url ?? event.id}`;
}

function isInCurrentCycle(event: WatchEvent, watch: Watch): boolean {
  return new Date(event.createdAt).getTime() >= new Date(watch.createdAt).getTime();
}

function isAtOrAfter(timestamp: string | undefined, cutoff: string): boolean {
  return timestampMillis(timestamp) >= timestampMillis(cutoff);
}

function isFresherEvent(left: WatchEvent, right: WatchEvent): boolean {
  const leftTime = timestampMillis(left.createdAt);
  const rightTime = timestampMillis(right.createdAt);
  return leftTime > rightTime || (leftTime === rightTime && left.id > right.id);
}

function isFeedback(event: WatchEvent): boolean {
  if (event.action === "deleted" || event.action === "dismissed") {
    return false;
  }
  if (event.kind === "issue_comment" && isBotAuthoredTriggerComment(event)) {
    return false;
  }
  if (event.kind === "review_thread") {
    return event.action !== "resolved";
  }
  if (event.kind === "review_comment" || event.kind === "issue_comment") {
    return true;
  }
  return event.kind === "review_submitted" && event.state?.toLowerCase() !== "approved";
}

function isBotAuthoredTriggerComment(event: WatchEvent): boolean {
  return event.body?.trim() === CODEX_REVIEW_TRIGGER_COMMENT && event.author?.toLowerCase().endsWith("[bot]") === true;
}

function nextCursor(db: WatchDatabase, watch: Watch): number {
  let cursor = watch.cursor;
  const events = db.events
    .filter((event) => event.watchId === watch.id && event.id > cursor)
    .sort((left, right) => left.id - right.id);

  for (const event of events) {
    if (!event.handledAt) {
      break;
    }
    cursor = event.id;
  }

  return cursor;
}

function lastEventIdForWatch(db: WatchDatabase, watchId: string): number {
  return db.events
    .filter((event) => event.watchId === watchId)
    .reduce((cursor, event) => Math.max(cursor, event.id), 0);
}

function isThumbsUp(reaction?: string): boolean {
  return reaction === "+1" || reaction?.toLowerCase() === "thumbs_up";
}

function timestampMillis(timestamp?: string): number {
  return timestamp ? new Date(timestamp).getTime() : 0;
}

function equalsLogin(left: string | undefined, right: string): boolean {
  return left?.toLowerCase() === right.toLowerCase();
}

function isCodexActor(login: string | undefined, codexLogins: Set<string>): boolean {
  return login ? codexLogins.has(login.toLowerCase()) : false;
}

function codexActorLogins(watch: Watch): Set<string> {
  return new Set(
    [watch.policy.botLogin, DEFAULT_CODEX_REVIEW_BOT_LOGIN, process.env.CODEX_REVIEW_BOT_LOGIN ?? ""]
      .filter((login) => login.length > 0)
      .map((login) => login.toLowerCase()),
  );
}

function minutesBetween(left: Date, right: Date): number {
  return (right.getTime() - left.getTime()) / 60000;
}
