// ─── Schema Validation ─────────────────────────────────────────────
// Zod schemas for runtime validation of .cardgame.json files.
// This is the "parse boundary" — raw JSON enters, typed data exits.
//
// Written against `zod/mini` (Zod 4's tree-shakable, function-first API)
// so the async schema chunk only carries the checks it actually uses.
// Same core, same issue shapes and messages as the classic API.

import type { CardGameRuleset } from "../types/index";
import * as z from "zod/mini";
import { RulesetParseError } from "../engine/interpreter";

// zod/mini does not install the English locale on its own (the classic
// API does it on first schema construction). Without this, messages fall
// back to a bare "Invalid input".
z.config(z.locales.en());

// ─── Helpers ───────────────────────────────────────────────────────

const nonEmptyString = () => z.string().check(z.minLength(1));
const positiveInt = () => z.int().check(z.minimum(1));

// ─── Primitives ────────────────────────────────────────────────────

const CardValueObjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fixed"), value: z.number() }),
  z.object({ kind: z.literal("dual"), low: z.number(), high: z.number() }),
]);

/** Accepts a bare number (shorthand for fixed) or the full object form. */
const CardValueSchema = z.union([
  z.pipe(
    z.number(),
    z.transform((n): { kind: "fixed"; value: number } => ({ kind: "fixed", value: n })),
  ),
  CardValueObjectSchema,
]);

const ZoneVisibilitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("public") }),
  z.object({ kind: z.literal("owner_only") }),
  z.object({ kind: z.literal("hidden") }),
  z.object({ kind: z.literal("partial"), rule: z.string() }),
]);

// ─── Sections ──────────────────────────────────────────────────────

const MetaSchema = z.object({
  name: nonEmptyString(),
  slug: z.string().check(z.regex(/^[a-z0-9-]+$/)),
  version: z.string().check(z.regex(/^\d+\.\d+\.\d+$/)),
  author: nonEmptyString(),
  players: z
    .object({
      min: positiveInt(),
      max: positiveInt(),
    })
    .check(z.refine((p) => p.min <= p.max, { error: "players.min must be <= players.max" })),
  description: z.optional(nonEmptyString()),
  tags: z.optional(z.array(nonEmptyString())),
  license: z.optional(nonEmptyString()),
});

const CardTemplateSchema = z.object({
  suit: nonEmptyString(),
  rank: nonEmptyString(),
});

const DeckSchema = z.discriminatedUnion("preset", [
  z.object({
    preset: z.enum(["standard_52", "standard_54"]),
    copies: z.int().check(z.minimum(1), z.maximum(100)),
    cardValues: z.record(z.string(), CardValueSchema),
  }),
  z.object({
    preset: z.literal("custom"),
    cards: z.array(CardTemplateSchema).check(z.minLength(1)),
    copies: z.int().check(z.minimum(1), z.maximum(100)),
    cardValues: z.record(z.string(), CardValueSchema),
  }),
]);

const ZoneSchema = z.object({
  name: nonEmptyString(),
  visibility: ZoneVisibilitySchema,
  owners: z.array(z.string()),
  maxCards: z.optional(positiveInt()),
  phaseOverrides: z.optional(
    z.array(
      z.object({
        phase: nonEmptyString(),
        visibility: ZoneVisibilitySchema,
      }),
    ),
  ),
});

const RoleSchema = z.object({
  name: nonEmptyString(),
  isHuman: z.boolean(),
  count: z.union([positiveInt(), z.literal("per_player")]),
});

const PhaseActionSchema = z.object({
  name: nonEmptyString(),
  label: nonEmptyString(),
  condition: z.optional(z.string()),
  effect: z.array(z.string()),
});

const PhaseTransitionSchema = z.object({
  to: nonEmptyString(),
  when: nonEmptyString(),
});

const PhaseSchema = z.object({
  name: nonEmptyString(),
  kind: z.enum(["automatic", "turn_based", "all_players"]),
  actions: z.array(PhaseActionSchema),
  transitions: z.array(PhaseTransitionSchema),
  onEnter: z.optional(z.array(z.string())),
  onStep: z.optional(z.array(z.string())),
  onExit: z.optional(z.array(z.string())),
  turnOrder: z.optional(z.enum(["clockwise", "counterclockwise", "fixed"])),
  autoEndTurnCondition: z.optional(z.string()),
});

const ScoringSchema = z.object({
  method: nonEmptyString(),
  winCondition: nonEmptyString(),
  bustCondition: z.optional(z.string()),
  tieCondition: z.optional(z.string()),
});

const UISchema = z.object({
  layout: z.enum(["semicircle", "circle", "grid", "linear"]),
  tableColor: z.enum(["felt_green", "wood", "dark", "custom"]),
  customColor: z.optional(z.string()),
});

const VariableDefinitionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("number"), initial: z.number(), public: z.optional(z.boolean()) }),
  z.object({ type: z.literal("string"), initial: z.string(), public: z.optional(z.boolean()) }),
]);

// ─── Complete Ruleset Schema ───────────────────────────────────────

export const CardGameRulesetSchema = z.object({
  $schema: z.optional(nonEmptyString()),
  meta: MetaSchema,
  deck: DeckSchema,
  zones: z.array(ZoneSchema).check(z.minLength(1)),
  roles: z.array(RoleSchema).check(z.minLength(1)),
  phases: z.array(PhaseSchema).check(z.minLength(1)),
  scoring: ScoringSchema,
  variables: z.optional(z.record(z.string(), VariableDefinitionSchema)),
  globalTransitions: z.optional(z.array(PhaseTransitionSchema)),
  ui: UISchema,
});

/** Inferred type from the Zod schema — should match CardGameRuleset. */
export type ParsedRuleset = z.infer<typeof CardGameRulesetSchema>;

/** Result of `safeParseRuleset`: `{ success, data }` or `{ success, error }`. */
export type RulesetParseResult = z.core.util.SafeParseResult<ParsedRuleset>;

/**
 * Parses raw JSON into a validated CardGameRuleset.
 * Returns the parsed data or throws a ZodError with detailed issues.
 */
export function parseRuleset(raw: unknown): ParsedRuleset {
  return z.parse(CardGameRulesetSchema, raw);
}

/**
 * Safe parse variant — returns a discriminated result instead of throwing.
 */
export function safeParseRuleset(raw: unknown): RulesetParseResult {
  return z.safeParse(CardGameRulesetSchema, raw);
}

// ─── loadRuleset ───────────────────────────────────────────────────

/**
 * Loads and validates a raw JSON object into a trusted CardGameRuleset.
 * This is the parse boundary — after this, the ruleset is guaranteed valid
 * and the engine (`createInitialState`, `createReducer`) takes it as-is.
 *
 * @throws {RulesetParseError} if the JSON does not conform to the schema.
 */
export function loadRuleset(raw: unknown): CardGameRuleset {
  try {
    return parseRuleset(raw) as CardGameRuleset;
  } catch (error: unknown) {
    if (
      error !== null &&
      typeof error === "object" &&
      "issues" in error &&
      Array.isArray((error as { issues: unknown[] }).issues)
    ) {
      const zodError = error as {
        issues: Array<{ path: PropertyKey[]; message: string }>;
      };
      const formattedIssues = zodError.issues.map(
        (issue) => `${issue.path.map(String).join(".")}: ${issue.message}`,
      );
      throw new RulesetParseError(
        `Invalid ruleset: ${formattedIssues.length} issue(s)`,
        formattedIssues,
      );
    }
    throw error;
  }
}
