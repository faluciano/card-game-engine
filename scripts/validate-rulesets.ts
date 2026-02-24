#!/usr/bin/env bun
// ─── Validate Rulesets ─────────────────────────────────────────────
// CLI script that validates all .cardgame.json files against the schema.
// Exits 0 if all pass, 1 if any fail.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { safeParseRuleset } from "../packages/schema/src/index";

const RULESETS_DIR = join(import.meta.dir, "..", "rulesets");

async function main(): Promise<void> {
  const entries = await readdir(RULESETS_DIR);
  const files = entries
    .filter((f) => f.endsWith(".cardgame.json"))
    .sort();

  if (files.length === 0) {
    console.error("No .cardgame.json files found in rulesets/");
    process.exit(1);
  }

  console.log(`\nValidating ${files.length} ruleset(s)...\n`);

  let failed = 0;

  for (const file of files) {
    const filePath = join(RULESETS_DIR, file);
    const raw = await readFile(filePath, "utf-8");

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error(`  \u274C ${file} — invalid JSON`);
      if (err instanceof Error) {
        console.error(`     ${err.message}`);
      }
      failed++;
      continue;
    }

    const result = safeParseRuleset(parsed);

    if (result.success) {
      console.log(`  \u2705 ${file}`);
    } else {
      console.error(`  \u274C ${file}`);
      for (const issue of result.error.issues) {
        const path = issue.path.join(".");
        console.error(`     ${path || "(root)"}: ${issue.message}`);
      }
      failed++;
    }
  }

  console.log();

  if (failed > 0) {
    console.error(`${failed} of ${files.length} ruleset(s) failed validation.`);
    process.exit(1);
  }

  console.log(`All ${files.length} ruleset(s) passed validation.`);
}

main();
