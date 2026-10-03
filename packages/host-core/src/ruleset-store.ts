// ─── Ruleset Store Contract ────────────────────────────────────────
// The persistence seam between the shared host logic and each platform.
// The Android TV host implements it on expo-file-system (FileRulesetStore);
// the browser display implements it on localStorage (WebRulesetStore).
// Hooks in this package take a store instance rather than a class so the
// same code runs unchanged on both.

import type { CardGameRuleset } from "@card-engine/shared";

/** A stored ruleset with metadata for the local database. */
export interface StoredRuleset {
  readonly id: string;
  readonly ruleset: CardGameRuleset;
  readonly importedAt: number;
  readonly lastPlayedAt: number | null;
}

/** Async CRUD over user-installed (non-built-in) rulesets. */
export interface RulesetStore {
  /** Lists all stored rulesets, sorted by importedAt descending. */
  list(): Promise<readonly StoredRuleset[]>;
  /** Returns a single stored ruleset by ID, or null if not found. */
  getById(id: string): Promise<StoredRuleset | null>;
  /** Saves a new ruleset to the store. Returns the stored entry. */
  save(ruleset: CardGameRuleset): Promise<StoredRuleset>;
  /** Saves a new ruleset, using the given slug for metadata instead of the ruleset's own slug. */
  saveWithSlug(ruleset: CardGameRuleset, slugOverride: string): Promise<StoredRuleset>;
  /** Deletes a stored ruleset by ID. */
  delete(id: string): Promise<void>;
  /** Finds a stored ruleset by slug. Useful for duplicate detection. */
  getBySlug(slug: string): Promise<StoredRuleset | null>;
}

// ─── Errors ────────────────────────────────────────────────────────

/**
 * Thrown when a store's metadata index exists but cannot be parsed.
 *
 * Stores throw rather than treating a corrupt index as empty: an empty
 * index would be rewritten by the next save and silently replace the
 * whole library with a single entry. Throwing leaves the user's data on
 * disk for recovery and lets the hooks surface the failure instead.
 */
export class RulesetStoreCorruptError extends Error {
  constructor(
    /** File URI or storage key of the corrupt index. */
    public readonly source: string,
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `Ruleset library index at "${source}" is corrupt and was not overwritten: ${detail}. ` +
        "Repair or remove it to continue installing rulesets.",
    );
    this.name = "RulesetStoreCorruptError";
  }
}

/** Thrown when the storage backend refuses a write because it is full. */
export class RulesetStoreQuotaError extends Error {
  constructor(
    /** Size of the rejected payload, in UTF-16 code units. */
    public readonly payloadSize: number,
  ) {
    super(
      `Ruleset storage is full: a ${payloadSize}-character write was rejected. ` +
        "Remove an installed ruleset to free space.",
    );
    this.name = "RulesetStoreQuotaError";
  }
}

/** True for the browser's `QuotaExceededError` in its DOMException and legacy forms. */
export function isQuotaExceededError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { name, code } = err as { readonly name?: unknown; readonly code?: unknown };
  // Firefox historically used NS_ERROR_DOM_QUOTA_REACHED; WebKit used code 22.
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22;
}

// ─── ID Generation ─────────────────────────────────────────────────

/**
 * Generates a UUID v4 for a stored ruleset. Prefers `crypto.randomUUID`;
 * falls back to a `Math.random`-based v4 on runtimes without it (Hermes).
 * Store IDs are opaque persistence keys, not gameplay randomness, so the
 * seeded-PRNG rule does not apply here.
 */
export function generateRulesetId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
