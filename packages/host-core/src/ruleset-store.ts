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
