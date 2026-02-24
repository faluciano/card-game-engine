#!/usr/bin/env bun
// ─── Build Catalog ─────────────────────────────────────────────────
// CLI script that reads all validated rulesets and produces catalog.json
// at the repo root. Only includes rulesets that pass schema validation.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { safeParseRuleset } from "../packages/schema/src/index";

const RULESETS_DIR = join(import.meta.dir, "..", "rulesets");
const OUTPUT_PATH = join(import.meta.dir, "..", "catalog.json");

interface CatalogEntry {
  name: string;
  slug: string;
  version: string;
  author: string;
  description?: string;
  tags?: string[];
  license?: string;
  players: { min: number; max: number };
  file: string;
}

interface Catalog {
  generatedAt: string;
  games: CatalogEntry[];
}

async function main(): Promise<void> {
  const entries = await readdir(RULESETS_DIR);
  const files = entries
    .filter((f) => f.endsWith(".cardgame.json"))
    .sort();

  if (files.length === 0) {
    console.error("No .cardgame.json files found in rulesets/");
    process.exit(1);
  }

  console.log(`\nBuilding catalog from ${files.length} ruleset(s)...\n`);

  const games: CatalogEntry[] = [];
  let skipped = 0;

  for (const file of files) {
    const filePath = join(RULESETS_DIR, file);
    const raw = await readFile(filePath, "utf-8");

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error(`  Skipping ${file} — invalid JSON`);
      skipped++;
      continue;
    }

    const result = safeParseRuleset(parsed);

    if (!result.success) {
      console.error(`  Skipping ${file} — schema validation failed`);
      skipped++;
      continue;
    }

    const { meta } = result.data;

    games.push({
      name: meta.name,
      slug: meta.slug,
      version: meta.version,
      author: meta.author,
      ...(meta.description !== undefined && { description: meta.description }),
      ...(meta.tags !== undefined && { tags: [...meta.tags] }),
      ...(meta.license !== undefined && { license: meta.license }),
      players: { min: meta.players.min, max: meta.players.max },
      file: `rulesets/${file}`,
    });

    console.log(`  + ${meta.name} (${meta.slug})`);
  }

  // Sort by name for stable ordering
  games.sort((a, b) => a.name.localeCompare(b.name));

  const catalog: Catalog = {
    generatedAt: new Date().toISOString(),
    games,
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(catalog, null, 2) + "\n", "utf-8");

  console.log();
  console.log(`Cataloged ${games.length} game(s) to catalog.json`);
  if (skipped > 0) {
    console.warn(`Skipped ${skipped} invalid ruleset(s).`);
  }
}

main();
