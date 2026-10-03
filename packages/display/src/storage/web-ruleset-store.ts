// ─── Web Ruleset Store ─────────────────────────────────────────────
// Browser-side counterpart of the host's FileRulesetStore. Persists
// installed (non-built-in) rulesets in localStorage under a single JSON
// index, implementing the RulesetStore contract the host-core hooks expect.

import type { CardGameRuleset } from "@card-engine/shared";
import type { RulesetStore, StoredRuleset } from "@card-engine/host-core";
import {
  RulesetStoreCorruptError,
  RulesetStoreQuotaError,
  generateRulesetId,
  isQuotaExceededError,
} from "@card-engine/host-core";

export type { StoredRuleset };

interface Entry {
  readonly slug: string;
  readonly ruleset: CardGameRuleset;
  readonly importedAt: number;
  readonly lastPlayedAt: number | null;
}

type Index = Record<string, Entry>;

const STORAGE_KEY = "card-engine:rulesets";

/** An index must be a plain JSON object keyed by id. */
function isIndex(value: unknown): value is Index {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Persists rulesets in `localStorage`, implementing `RulesetStore` so the
 * host-core ruleset hooks work unchanged on the web display.
 */
export class WebRulesetStore implements RulesetStore {
  /**
   * Reads the index. A missing key is an empty library; an unparseable one
   * throws {@link RulesetStoreCorruptError} so a later save cannot overwrite
   * the whole library with a single entry.
   */
  private read(): Index {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new RulesetStoreCorruptError(STORAGE_KEY, err);
    }
    if (!isIndex(parsed)) {
      throw new RulesetStoreCorruptError(
        STORAGE_KEY,
        `expected an object keyed by id, got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
      );
    }
    return parsed;
  }

  /** Writes the index, translating a full-storage failure into a descriptive error. */
  private write(index: Index): void {
    const payload = JSON.stringify(index);
    try {
      localStorage.setItem(STORAGE_KEY, payload);
    } catch (err) {
      if (isQuotaExceededError(err)) throw new RulesetStoreQuotaError(payload.length);
      throw err;
    }
  }

  private toStored(id: string, e: Entry): StoredRuleset {
    return { id, ruleset: e.ruleset, importedAt: e.importedAt, lastPlayedAt: e.lastPlayedAt };
  }

  async list(): Promise<readonly StoredRuleset[]> {
    const index = this.read();
    return Object.entries(index)
      .map(([id, e]) => this.toStored(id, e))
      .sort((a, b) => b.importedAt - a.importedAt);
  }

  async getById(id: string): Promise<StoredRuleset | null> {
    if (!id) return null;
    const e = this.read()[id];
    return e ? this.toStored(id, e) : null;
  }

  async save(ruleset: CardGameRuleset): Promise<StoredRuleset> {
    return this.saveWithSlug(ruleset, ruleset.meta.slug);
  }

  async saveWithSlug(ruleset: CardGameRuleset, slugOverride: string): Promise<StoredRuleset> {
    const index = this.read();
    const id = generateRulesetId();
    const now = Date.now();
    index[id] = { slug: slugOverride, ruleset, importedAt: now, lastPlayedAt: null };
    this.write(index);
    return { id, ruleset, importedAt: now, lastPlayedAt: null };
  }

  async delete(id: string): Promise<void> {
    if (!id) return;
    const index = this.read();
    if (index[id]) {
      delete index[id];
      this.write(index);
    }
  }

  async getBySlug(slug: string): Promise<StoredRuleset | null> {
    if (!slug) return null;
    const entry = Object.entries(this.read()).find(([, e]) => e.slug === slug);
    return entry ? this.toStored(entry[0], entry[1]) : null;
  }
}

/**
 * Module-level store instance shared by every host-core hook. The hooks take
 * the store as a dependency, so a single stable instance avoids re-running
 * effects on each render.
 */
export const rulesetStore = new WebRulesetStore();
