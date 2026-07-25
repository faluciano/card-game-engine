// ─── Web Ruleset Store ─────────────────────────────────────────────
// Browser-side port of the host's FileRulesetStore. Persists installed
// (non-built-in) rulesets in localStorage under a single JSON index,
// exposing the same async interface the ruleset hooks expect.

import type { CardGameRuleset } from "@card-engine/shared";

/** A stored ruleset with metadata for the local database. */
export interface StoredRuleset {
  readonly id: string;
  readonly ruleset: CardGameRuleset;
  readonly importedAt: number;
  readonly lastPlayedAt: number | null;
}

interface Entry {
  readonly slug: string;
  readonly ruleset: CardGameRuleset;
  readonly importedAt: number;
  readonly lastPlayedAt: number | null;
}

type Index = Record<string, Entry>;

const STORAGE_KEY = "card-engine:rulesets";

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Persists rulesets in `localStorage`, mirroring the host `FileRulesetStore`
 * API so the ruleset orchestration hooks work unchanged on the web display.
 */
export class WebRulesetStore {
  private read(): Index {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Index) : {};
    } catch {
      return {};
    }
  }

  private write(index: Index): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(index));
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
    const id = generateId();
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
