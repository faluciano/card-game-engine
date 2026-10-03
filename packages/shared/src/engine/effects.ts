// ─── Effect Descriptions ───────────────────────────────────────────
// Effect builtins record *intent* as plain data; the interpreter applies
// it. Keeping the union here (rather than in builtins.ts) lets both sides
// share one exhaustive type without a circular import.

// ─── Parameter Shapes ──────────────────────────────────────────────

/** A single zone by name. */
export interface ZoneParams {
  readonly zone: string;
}

/** Move `count` cards from one zone to another. */
export interface TransferParams {
  readonly from: string;
  readonly to: string;
  readonly count: number;
}

export interface SetFaceUpParams {
  readonly zone: string;
  readonly cardIndex: number;
  readonly faceUp: boolean;
}

export interface FlipTopParams {
  readonly zone: string;
  readonly count: number;
}

export interface MoveAllParams {
  readonly from: string;
  readonly to: string;
}

export interface MoveRankParams {
  readonly from: string;
  readonly to: string;
  readonly rank: string;
}

export interface PlayerIndexParams {
  readonly playerIndex: number;
}

export interface SetVarParams {
  readonly name: string;
  readonly value: number;
}

export interface SetStrVarParams {
  readonly name: string;
  readonly value: string;
}

export interface IncVarParams {
  readonly name: string;
  readonly amount: number;
}

export interface CollectTrickParams {
  readonly zonePrefix: string;
  readonly targetZone: string;
}

/** Marker for effects that take no parameters. */
export type NoParams = Record<string, never>;

// ─── Effect Union ──────────────────────────────────────────────────

/**
 * A description of a state-changing effect recorded by effect builtins.
 * Discriminated on `kind`; `params` is typed per effect so the interpreter
 * can switch exhaustively without casting.
 */
export type EffectDescription =
  | { readonly kind: "shuffle"; readonly params: ZoneParams }
  | { readonly kind: "deal"; readonly params: TransferParams }
  | { readonly kind: "draw"; readonly params: TransferParams }
  | { readonly kind: "set_face_up"; readonly params: SetFaceUpParams }
  | { readonly kind: "reveal_all"; readonly params: ZoneParams }
  | { readonly kind: "end_turn"; readonly params: NoParams }
  | { readonly kind: "calculate_scores"; readonly params: NoParams }
  | { readonly kind: "determine_winners"; readonly params: NoParams }
  | { readonly kind: "collect_all_to"; readonly params: ZoneParams }
  | { readonly kind: "reset_round"; readonly params: NoParams }
  | { readonly kind: "move_top"; readonly params: TransferParams }
  | { readonly kind: "flip_top"; readonly params: FlipTopParams }
  | { readonly kind: "move_all"; readonly params: MoveAllParams }
  | { readonly kind: "move_rank"; readonly params: MoveRankParams }
  | { readonly kind: "reverse_turn_order"; readonly params: NoParams }
  | { readonly kind: "skip_next_player"; readonly params: NoParams }
  | { readonly kind: "set_next_player"; readonly params: PlayerIndexParams }
  | { readonly kind: "set_var"; readonly params: SetVarParams }
  | { readonly kind: "set_str_var"; readonly params: SetStrVarParams }
  | { readonly kind: "inc_var"; readonly params: IncVarParams }
  | { readonly kind: "collect_trick"; readonly params: CollectTrickParams }
  | { readonly kind: "set_lead_player"; readonly params: PlayerIndexParams }
  | { readonly kind: "end_game"; readonly params: NoParams }
  | { readonly kind: "accumulate_scores"; readonly params: NoParams };

/** The `kind` discriminant of {@link EffectDescription}. */
export type EffectKind = EffectDescription["kind"];

// ─── Errors ────────────────────────────────────────────────────────

/**
 * Thrown when an effect cannot be applied to the current state — most
 * commonly because a ruleset names a zone that does not exist. Silently
 * skipping would lose or strand cards, so this is always loud.
 */
export class EffectError extends Error {
  constructor(
    message: string,
    public readonly effectKind: EffectKind,
  ) {
    super(message);
    this.name = "EffectError";
  }
}

/** Builds the error for an effect that references a zone the state lacks. */
export function missingZoneError(kind: EffectKind, zoneName: string): EffectError {
  return new EffectError(`Effect "${kind}" references unknown zone "${zoneName}"`, kind);
}
