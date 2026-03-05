// ─── Schema Validation ─────────────────────────────────────────────
// Zod schemas for runtime validation of .cardgame.json files.
// This is the "parse boundary" — raw JSON enters, typed data exits.

import { z } from "zod";

// ─── Primitives ────────────────────────────────────────────────────

const CardValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fixed"), value: z.number() }),
  z.object({ kind: z.literal("dual"), low: z.number(), high: z.number() }),
]);

const ZoneVisibilitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("public") }),
  z.object({ kind: z.literal("owner_only") }),
  z.object({ kind: z.literal("hidden") }),
  z.object({ kind: z.literal("partial"), rule: z.string() }),
]);

// ─── Sections ──────────────────────────────────────────────────────

const MetaSchema = z.object({
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  author: z.string().min(1),
  players: z.object({
    min: z.number().int().min(1),
    max: z.number().int().min(1),
  }).refine(
    (p) => p.min <= p.max,
    { message: "players.min must be <= players.max" }
  ),
  description: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).optional(),
  license: z.string().min(1).optional(),
});

const CardTemplateSchema = z.object({
  suit: z.string().min(1),
  rank: z.string().min(1),
});

const DeckSchema = z.discriminatedUnion("preset", [
  z.object({
    preset: z.enum(["standard_52", "standard_54"]),
    copies: z.number().int().min(1).max(100),
    cardValues: z.record(z.string(), CardValueSchema),
  }),
  z.object({
    preset: z.literal("custom"),
    cards: z.array(CardTemplateSchema).min(1),
    copies: z.number().int().min(1).max(100),
    cardValues: z.record(z.string(), CardValueSchema),
  }),
]);

const ZoneSchema = z.object({
  name: z.string().min(1),
  visibility: ZoneVisibilitySchema,
  owners: z.array(z.string()),
  maxCards: z.number().int().min(1).optional(),
  phaseOverrides: z.array(z.object({
    phase: z.string().min(1),
    visibility: ZoneVisibilitySchema,
  })).optional(),
});

const RoleSchema = z.object({
  name: z.string().min(1),
  isHuman: z.boolean(),
  count: z.union([z.number().int().min(1), z.literal("per_player")]),
});

const PhaseActionSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  condition: z.string().optional(),
  effect: z.array(z.string()),
});

const PhaseTransitionSchema = z.object({
  to: z.string().min(1),
  when: z.string().min(1),
});

const PhaseSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["automatic", "turn_based", "all_players"]),
  actions: z.array(PhaseActionSchema),
  transitions: z.array(PhaseTransitionSchema),
  onEnter: z.array(z.string()).optional(),
  onExit: z.array(z.string()).optional(),
  turnOrder: z.enum(["clockwise", "counterclockwise", "fixed"]).optional(),
  autoEndTurnCondition: z.string().optional(),
});

const ScoringSchema = z.object({
  method: z.string().min(1),
  winCondition: z.string().min(1),
  bustCondition: z.string().optional(),
  tieCondition: z.string().optional(),
});

const UISchema = z.object({
  layout: z.enum(["semicircle", "circle", "grid", "linear"]),
  tableColor: z.enum(["felt_green", "wood", "dark", "custom"]),
  customColor: z.string().optional(),
});

const VariableDefinitionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("number"), initial: z.number(), public: z.boolean().optional() }),
  z.object({ type: z.literal("string"), initial: z.string(), public: z.boolean().optional() }),
]);

// ─── Complete Ruleset Schema ───────────────────────────────────────

export const CardGameRulesetSchema = z.object({
  $schema: z.string().min(1).optional(),
  meta: MetaSchema,
  deck: DeckSchema,
  zones: z.array(ZoneSchema).min(1),
  roles: z.array(RoleSchema).min(1),
  phases: z.array(PhaseSchema).min(1),
  scoring: ScoringSchema,
  variables: z.record(z.string(), VariableDefinitionSchema).optional(),
  ui: UISchema,
});

/** Inferred type from the Zod schema — should match CardGameRuleset. */
export type ParsedRuleset = z.infer<typeof CardGameRulesetSchema>;

/**
 * Parses raw JSON into a validated CardGameRuleset.
 * Returns the parsed data or throws a ZodError with detailed issues.
 */
export function parseRuleset(raw: unknown): ParsedRuleset {
  return CardGameRulesetSchema.parse(raw);
}

/**
 * Safe parse variant — returns a discriminated result instead of throwing.
 */
export function safeParseRuleset(
  raw: unknown
): z.SafeParseReturnType<unknown, ParsedRuleset> {
  return CardGameRulesetSchema.safeParse(raw);
}
