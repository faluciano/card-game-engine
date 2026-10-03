// ─── Memory Ruleset Store ──────────────────────────────────────────
// In-memory RulesetStore. Used by the hook tests in this package; also a
// usable fallback for hosts without durable storage.

import type { CardGameRuleset } from "@card-engine/shared";
import type { RulesetStore, StoredRuleset } from "./ruleset-store";

/** Non-durable `RulesetStore` backed by a Map. */
export class MemoryRulesetStore implements RulesetStore {
  private readonly entries = new Map<string, StoredRuleset & { readonly slug: string }>();
  private nextId = 1;

  async list(): Promise<readonly StoredRuleset[]> {
    return [...this.entries.values()]
      .map(({ slug: _slug, ...stored }) => stored)
      .sort((a, b) => b.importedAt - a.importedAt);
  }

  async getById(id: string): Promise<StoredRuleset | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const { slug: _slug, ...stored } = entry;
    return stored;
  }

  async save(ruleset: CardGameRuleset): Promise<StoredRuleset> {
    return this.saveWithSlug(ruleset, ruleset.meta.slug);
  }

  async saveWithSlug(ruleset: CardGameRuleset, slugOverride: string): Promise<StoredRuleset> {
    const id = `mem-${this.nextId++}`;
    const stored: StoredRuleset = { id, ruleset, importedAt: Date.now(), lastPlayedAt: null };
    this.entries.set(id, { ...stored, slug: slugOverride });
    return stored;
  }

  async delete(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async getBySlug(slug: string): Promise<StoredRuleset | null> {
    for (const entry of this.entries.values()) {
      if (entry.slug === slug) {
        const { slug: _slug, ...stored } = entry;
        return stored;
      }
    }
    return null;
  }
}
