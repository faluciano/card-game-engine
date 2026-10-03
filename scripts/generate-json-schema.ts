#!/usr/bin/env bun
// ─── Generate JSON Schema ──────────────────────────────────────────
// Derives packages/shared/src/schema/cardgame.v1.schema.json from the Zod
// schema in validation.ts, so the editor-facing JSON Schema can never
// drift from the runtime parse boundary.
//
// Usage:
//   bun run scripts/generate-json-schema.ts          # rewrite the file
//   bun run scripts/generate-json-schema.ts --check  # exit 1 on drift

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as z from "zod/mini";
import { CardGameRulesetSchema } from "../packages/shared/src/schema/index";

const OUTPUT_PATH = join(
  import.meta.dir,
  "..",
  "packages",
  "shared",
  "src",
  "schema",
  "cardgame.v1.schema.json",
);

// Stable metadata: rulesets point at this file via "$schema", and the "$id"
// is what editors cache the document under. Keep these fixed across regens.
const METADATA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://card-engine.dev/schemas/cardgame.v1.json",
  title: "Card Game Ruleset",
  description: "Schema for .cardgame.json files defining a card game's rules.",
} as const;

/**
 * `z.int()` emits `minimum`/`maximum` at the safe-integer limits. They add
 * nothing beyond `"type": "integer"` and bloat every integer field, so strip
 * exactly those sentinel values while leaving real bounds (e.g. `copies`).
 */
function stripSafeIntegerBounds(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripSafeIntegerBounds);
  if (node === null || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "maximum" && value === Number.MAX_SAFE_INTEGER) continue;
    if (key === "minimum" && value === Number.MIN_SAFE_INTEGER) continue;
    out[key] = stripSafeIntegerBounds(value);
  }
  return out;
}

function renderSchema(): string {
  // io: "input" describes what a .cardgame.json file may contain (before Zod
  // transforms such as the numeric card-value shorthand), which is what an
  // editor validating the file on disk needs.
  const generated = z.toJSONSchema(CardGameRulesetSchema, {
    target: "draft-7",
    io: "input",
    unrepresentable: "any",
  });

  // Drop whatever "$schema" Zod emitted so METADATA controls the key order.
  const { $schema: _ignored, ...body } = generated;
  const schema = { ...METADATA, ...(stripSafeIntegerBounds(body) as object) };

  return `${JSON.stringify(schema, null, 2)}\n`;
}

async function main(): Promise<void> {
  const isCheck = process.argv.includes("--check");
  const next = renderSchema();

  if (!isCheck) {
    await writeFile(OUTPUT_PATH, next, "utf-8");
    console.log(`Wrote ${OUTPUT_PATH}`);
    return;
  }

  const current = await readFile(OUTPUT_PATH, "utf-8").catch(() => "");

  if (current === next) {
    console.log("JSON Schema is up to date with the Zod schema.");
    return;
  }

  console.error(
    "JSON Schema drift detected: cardgame.v1.schema.json does not match validation.ts.",
  );
  console.error("Run `bun run schema:generate` and commit the result.");
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
