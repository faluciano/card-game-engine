// ─── Schema Validation ─────────────────────────────────────────────
// Zod schemas for runtime validation of .cardgame.json files.
// This is the "parse boundary" — raw JSON enters, typed data exits.
//
// Written against `zod/mini` (Zod 4's tree-shakable, function-first API)
// so the async schema chunk only carries the checks it actually uses.
// Same core, same issue shapes and messages as the classic API.

import type { CardGameRuleset } from "../types/index";
import * as z from "zod/mini";
import { DEFAULT_PLAY_TO_ZONE } from "../engine/action-validator";
import { compileExpression, ExpressionError } from "../engine/expression-evaluator";
import { RulesetParseError } from "../engine/interpreter";
import { PARTIAL_VISIBILITY_RULES } from "../engine/state-filter";

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
  z.object({ kind: z.literal("partial"), rule: z.enum(PARTIAL_VISIBILITY_RULES) }),
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

const ActionParamSpecSchema = z.object({
  kind: z.enum(["other_player", "selected_card_rank"]),
});

const PhaseActionSchema = z.object({
  name: nonEmptyString(),
  label: nonEmptyString(),
  condition: z.optional(z.string()),
  effect: z.array(z.string()),
  playTo: z.optional(nonEmptyString()),
  params: z.optional(z.record(nonEmptyString(), ActionParamSpecSchema)),
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

// ─── Cross-Reference Checks ────────────────────────────────────────
// Structural parsing alone accepts rulesets whose names don't line up
// (a transition to a phase that doesn't exist, a zone owned by an
// undeclared role) or whose expressions don't parse. Those used to surface
// mid-game; this pass rejects them at load time instead.

/** Shape the cross-reference pass reads — the structurally parsed ruleset. */
interface CrossCheckedRuleset {
  readonly zones: readonly {
    readonly name: string;
    readonly owners: readonly string[];
    readonly phaseOverrides?: readonly { readonly phase: string }[] | undefined;
  }[];
  readonly roles: readonly { readonly name: string }[];
  readonly phases: readonly {
    readonly name: string;
    readonly actions: readonly {
      readonly name: string;
      readonly condition?: string | undefined;
      readonly effect: readonly string[];
      readonly playTo?: string | undefined;
    }[];
    readonly transitions: readonly { readonly to: string; readonly when: string }[];
    readonly onEnter?: readonly string[] | undefined;
    readonly onStep?: readonly string[] | undefined;
    readonly onExit?: readonly string[] | undefined;
    readonly autoEndTurnCondition?: string | undefined;
  }[];
  readonly scoring: {
    readonly method: string;
    readonly winCondition: string;
    readonly bustCondition?: string | undefined;
    readonly tieCondition?: string | undefined;
  };
  readonly globalTransitions?:
    | readonly { readonly to: string; readonly when: string }[]
    | undefined;
}

type IssuePath = readonly (string | number)[];

/** Yields every expression string in the ruleset alongside its path. */
function* collectExpressions(ruleset: CrossCheckedRuleset): Generator<[IssuePath, string]> {
  for (const [p, phase] of ruleset.phases.entries()) {
    for (const [a, action] of phase.actions.entries()) {
      if (action.condition !== undefined) {
        yield [["phases", p, "actions", a, "condition"], action.condition];
      }
      for (const [e, effect] of action.effect.entries()) {
        yield [["phases", p, "actions", a, "effect", e], effect];
      }
    }
    for (const [t, transition] of phase.transitions.entries()) {
      yield [["phases", p, "transitions", t, "when"], transition.when];
    }
    for (const hook of ["onEnter", "onStep", "onExit"] as const) {
      for (const [i, expression] of (phase[hook] ?? []).entries()) {
        yield [["phases", p, hook, i], expression];
      }
    }
    if (phase.autoEndTurnCondition !== undefined) {
      yield [["phases", p, "autoEndTurnCondition"], phase.autoEndTurnCondition];
    }
  }
  for (const [t, transition] of (ruleset.globalTransitions ?? []).entries()) {
    yield [["globalTransitions", t, "when"], transition.when];
  }
  for (const field of ["method", "winCondition", "bustCondition", "tieCondition"] as const) {
    const expression = ruleset.scoring[field];
    if (expression !== undefined) {
      yield [["scoring", field], expression];
    }
  }
}

/** Formats a set of declared names for an error message. */
function formatDeclared(names: ReadonlySet<string>): string {
  return [...names].map((n) => `"${n}"`).join(", ") || "(none)";
}

/**
 * Cross-checks names and expression syntax across ruleset sections.
 * Each problem is reported as its own issue at the offending path.
 */
function checkCrossReferences(
  ruleset: CrossCheckedRuleset,
  ctx: z.core.$RefinementCtx<CrossCheckedRuleset>,
): void {
  const report = (path: IssuePath, message: string): void => {
    ctx.addIssue({ code: "custom", message, path: [...path], input: ruleset });
  };

  const phaseNames = new Set(ruleset.phases.map((phase) => phase.name));
  const roleNames = new Set(ruleset.roles.map((role) => role.name));

  for (const [p, phase] of ruleset.phases.entries()) {
    for (const [t, transition] of phase.transitions.entries()) {
      if (!phaseNames.has(transition.to)) {
        report(
          ["phases", p, "transitions", t, "to"],
          `Transition targets undeclared phase "${transition.to}". Declared phases: ${formatDeclared(phaseNames)}`,
        );
      }
    }
  }

  for (const [t, transition] of (ruleset.globalTransitions ?? []).entries()) {
    if (!phaseNames.has(transition.to)) {
      report(
        ["globalTransitions", t, "to"],
        `Global transition targets undeclared phase "${transition.to}". Declared phases: ${formatDeclared(phaseNames)}`,
      );
    }
  }

  const zoneNames = new Set(ruleset.zones.map((zone) => zone.name));
  for (const [p, phase] of ruleset.phases.entries()) {
    for (const [a, action] of phase.actions.entries()) {
      if (action.name !== "play_card") {
        if (action.playTo !== undefined) {
          report(
            ["phases", p, "actions", a, "playTo"],
            `Action "${action.name}" sets playTo, which only applies to "play_card" actions`,
          );
        }
        continue;
      }
      const playTo = action.playTo ?? DEFAULT_PLAY_TO_ZONE;
      if (!zoneNames.has(playTo)) {
        report(
          ["phases", p, "actions", a, action.playTo === undefined ? "name" : "playTo"],
          `"play_card" in phase "${phase.name}" plays cards to undeclared zone "${playTo}"${action.playTo === undefined ? " (the default; set playTo)" : ""}. Declared zones: ${formatDeclared(zoneNames)}`,
        );
      }
    }
  }

  for (const [zi, zone] of ruleset.zones.entries()) {
    for (const [o, owner] of zone.owners.entries()) {
      if (!roleNames.has(owner)) {
        report(
          ["zones", zi, "owners", o],
          `Zone "${zone.name}" is owned by undeclared role "${owner}". Declared roles: ${formatDeclared(roleNames)}`,
        );
      }
    }
    for (const [i, override] of (zone.phaseOverrides ?? []).entries()) {
      if (!phaseNames.has(override.phase)) {
        report(
          ["zones", zi, "phaseOverrides", i, "phase"],
          `Zone "${zone.name}" overrides visibility for undeclared phase "${override.phase}". Declared phases: ${formatDeclared(phaseNames)}`,
        );
      }
    }
  }

  for (const [path, expression] of collectExpressions(ruleset)) {
    try {
      compileExpression(expression);
    } catch (error) {
      if (!(error instanceof ExpressionError)) throw error;
      report(path, `Invalid expression: ${error.message}`);
    }
  }
}

// ─── Complete Ruleset Schema ───────────────────────────────────────

export const CardGameRulesetSchema = z
  .object({
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
  })
  .check(z.superRefine(checkCrossReferences));

/** Inferred type from the Zod schema — should match CardGameRuleset. */
export type ParsedRuleset = z.infer<typeof CardGameRulesetSchema>;

// ─── Type-Level Assertion ──────────────────────────────────────────
// Compile-time proof that the schema output is a valid CardGameRuleset, so
// `loadRuleset` needs no cast. Only this direction holds: the schema is
// deliberately stricter (e.g. `partial.rule` is an enum, while the domain
// type keeps `string`), so CardGameRuleset is not assignable back.

type AssertAssignable<T extends U, U> = T;
export type ParsedRulesetIsCardGameRuleset = AssertAssignable<ParsedRuleset, CardGameRuleset>;

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
    const ruleset: CardGameRuleset = parseRuleset(raw);
    return ruleset;
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
