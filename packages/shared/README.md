# @card-engine/shared

Pure TypeScript card game engine with zero framework dependencies. Parses declarative `.cardgame.json` rulesets and provides a reducer-based game loop compatible with CouchKit's `(state, action) => state` pattern.

The engine interprets ruleset files at runtime -- no code generation, no game-specific logic. Define a card game as JSON; the engine handles phases, actions, scoring, and visibility.

## API Reference

All public symbols are re-exported from `src/index.ts` through four module groups: types, engine, deck, and schema.

### Interpreter

The interpreter is the primary entry point. It transforms a static ruleset into runtime constructs: a reducer, an initial state factory, and a phase machine.

```typescript
import { loadRuleset, createInitialState, createReducer } from "@card-engine/shared";

// Parse and validate a raw JSON object into a typed ruleset.
// Throws RulesetParseError if the JSON does not conform to the schema.
loadRuleset(raw: unknown): CardGameRuleset

// Create the starting game state for a session.
// Sets up the deck and zones per the ruleset. Does NOT shuffle or deal --
// that happens when start_game triggers the first automatic phase.
createInitialState(
  ruleset: CardGameRuleset,
  sessionId: GameSessionId,
  players: readonly Player[],
  seed?: number
): CardGameState

// Create a pure reducer bound to a specific ruleset and seed.
// Handles all 9 action variants: join, leave, start_game, declare,
// play_card, draw_card, end_turn, advance_phase, reset_round.
createReducer(ruleset: CardGameRuleset, seed?: number): GameReducer
```

### Expression Evaluator

A safe, sandboxed evaluator for the ruleset's expression DSL. No `eval()` or `Function()` -- expressions are tokenized, parsed into an AST, and evaluated against a restricted grammar.

```typescript
import {
  tokenize, evaluateExpression, evaluateCondition,
  type Token, type ASTNode, type EvalResult, type EvalContext
} from "@card-engine/shared";

// Tokenize an expression string into a token stream.
tokenize(input: string): readonly Token[]

// Parse a token stream into an AST.
// Throws ExpressionError on syntax errors or if the AST exceeds 1000 nodes.
parse(tokens: readonly Token[]): ASTNode

// Evaluate an expression string against a game context.
evaluateExpression(expression: string, context: EvalContext): EvalResult

// Evaluate an expression and coerce the result to boolean.
// Convenience wrapper for transition conditions.
evaluateCondition(expression: string, context: EvalContext): boolean
```

### Phase Machine

A finite state machine that manages game phase transitions. Each phase has a kind (`automatic`, `turn_based`, or `all_players`), allowed actions, and conditional transitions.

```typescript
import { PhaseMachine, type TransitionResult } from "@card-engine/shared";

const machine = new PhaseMachine(ruleset.phases);

// Evaluate transitions for the current phase.
// Returns the first matching transition or { kind: "stay" }.
machine.evaluateTransitions(state: CardGameState): TransitionResult

// Execute an automatic phase's sequence expressions.
// Returns collected effect descriptions without mutating state.
machine.executeAutomaticPhase(state: CardGameState): EffectDescription[]

// Query helpers
machine.getPhase(name: string): PhaseDefinition
machine.getValidActionsForPhase(name: string): readonly PhaseAction[]
machine.isAutomaticPhase(name: string): boolean
machine.phaseNames: readonly string[]
```

### Action Validator

Determines which actions are valid for a given player in the current game state. Prevents illegal moves at the engine level.

```typescript
import {
  getValidActions, validateAction, executePhaseAction,
  type ValidAction, type ActionValidationResult
} from "@card-engine/shared";

// Returns all actions available to a player in the current phase.
// Evaluates each action's condition to determine enabled/disabled state.
getValidActions(
  state: CardGameState,
  playerId: PlayerId,
  phaseMachine?: PhaseMachine
): readonly ValidAction[]

// Validates whether a specific action is legal.
// Returns a discriminated result with the rejection reason on failure.
validateAction(
  state: CardGameState,
  action: CardGameAction,
  phaseMachine?: PhaseMachine
): ActionValidationResult
// => { valid: true } | { valid: false; reason: string }

// Executes a phase action's effect expressions.
// Returns collected effect descriptions without mutating state.
executePhaseAction(
  state: CardGameState,
  actionName: string,
  playerIndex: number,
  phaseMachine: PhaseMachine,
  actionParams?: Readonly<Record<string, string | number | boolean>>
): EffectDescription[]
```

### State Filter

Produces per-player views of the game state, hiding information the player should not see (opponent hands, face-down cards). This is the security boundary for multiplayer.

```typescript
import { createPlayerView } from "@card-engine/shared";

// Create a filtered view for one player.
// Applies visibility rules from the ruleset. Hidden cards become null.
createPlayerView(state: CardGameState, playerId: PlayerId): PlayerView
```

### PRNG

Deterministic pseudo-random number generation (mulberry32) for reproducible game replays. All randomness flows through a seed -- no `Math.random()`.

```typescript
import { SeededRng, createRng } from "@card-engine/shared";

class SeededRng {
  constructor(seed: number)
  next(): number              // [0, 1)
  nextInt(min: number, max: number): number  // [min, max)
  shuffle<T>(array: readonly T[]): T[]       // Fisher-Yates, returns new array
  pick<T>(array: readonly T[]): T            // Random element
}

// Factory function
createRng(seed: number): SeededRng
```

### Schema Validation

Zod-based runtime validation of `.cardgame.json` files. This is the parse boundary -- raw JSON enters, typed data exits.

```typescript
import {
  parseRuleset, safeParseRuleset, CardGameRulesetSchema
} from "@card-engine/shared";

// Parse raw JSON into a validated ruleset. Throws ZodError on invalid input.
parseRuleset(json: unknown): ParsedRuleset

// Safe variant -- returns a discriminated result instead of throwing.
safeParseRuleset(json: unknown): z.SafeParseReturnType<unknown, ParsedRuleset>
```

### Deck Presets

Built-in deck templates for common card games.

```typescript
import {
  getPresetDeck, instantiateCards, standard52, standard54, uno108
} from "@card-engine/shared";

// Retrieve a preset deck's card templates by name.
getPresetDeck(preset: "standard_52" | "standard_54" | "uno_108"): readonly CardTemplate[]

// Instantiate templates into Card objects with unique IDs.
// Cards start face-down by default.
instantiateCards(templates: readonly CardTemplate[], copies?: number): readonly Card[]

// Individual preset factories
standard52(): readonly CardTemplate[]   // 4 suits x 13 ranks
standard54(): readonly CardTemplate[]   // 52 + 2 jokers
uno108(): readonly CardTemplate[]       // 4 colors x 25 + 8 wilds
```

### Host Bridge Layer

The bridge layer reconciles CouchKit's `IGameState` world (Record-based players, string status) with the card engine's `CardGameState` world (array-based players, discriminated-union status). It lives in shared so both host and client packages can import it.

```typescript
import {
  hostReducer,
  createHostInitialState,
  hostReducerImpl,
  deriveStatus,
  type HostGameState,
  type HostAction,
  type HostScreen,
} from "@card-engine/shared";

// Create initial state for CouchKit's GameHostProvider or useGameClient.
createHostInitialState(): HostGameState

// CouchKit-wrapped reducer (handles __HYDRATE__, __PLAYER_JOINED__, etc.)
hostReducer: GameReducer<HostGameState, HostAction | InternalAction>

// Inner reducer without CouchKit wrapping (for testing).
hostReducerImpl(state: HostGameState, action: HostAction): HostGameState

// Derive a flat status string from screen + engine state.
deriveStatus(screen: HostScreen, engineState: CardGameState | null): string
```

`HostAction` is a discriminated union of 6 variants: `SELECT_RULESET`, `BACK_TO_PICKER`, `START_GAME`, `GAME_ACTION`, `RESET_ROUND`, `ADVANCE_PHASE`.

`HostScreen` is a discriminated union on `tag`: `"ruleset_picker"`, `"lobby"`, `"game_table"`.

## Expression Language

The engine uses a safe expression DSL for conditions, effects, and automatic sequences in rulesets. Expressions are strings like `"hand_value(current_player.hand) > 21"` or `"card_count(draw_pile) == 0"`.

### Operator Precedence

Lowest to highest:

| Precedence | Operators       | Description                       |
|------------|-----------------|-----------------------------------|
| 1          | `\|\|`          | Logical OR (short-circuit)        |
| 2          | `&&`            | Logical AND (short-circuit)       |
| 3          | `==`, `!=`      | Equality                          |
| 4          | `<`, `>`, `<=`, `>=` | Comparison                   |
| 5          | `+`, `-`        | Addition, subtraction             |
| 6          | `*`, `/`        | Multiplication, division          |
| 7          | `!`, unary `-`  | Logical NOT, numeric negation     |

### Literals

- Numbers: `42`, `3.14`
- Strings: `"hello"`, `'world'`
- Booleans: `true`, `false`

### Variables

Identifiers resolve from context bindings. Member access via dot notation:

- `current_player.hand` resolves to the current player's per-player hand zone name (e.g., `"hand:0"`)
- `current_player.index` resolves to the current player's index
- `current_player_index`, `turn_number`, `player_count` are top-level bindings
- Zone names (e.g., `draw_pile`, `hand`) resolve to string zone references for use with builtins

### Function Calls

```
functionName(arg1, arg2, ...)
```

Functions are registered builtins. Unknown function names produce an `ExpressionError`.

### Special Forms

- `while(condition, body)` -- Loops with mid-iteration effect flushing. The accumulated effects are applied to state between iterations so condition re-evaluation sees updated zones.
- `if(condition, then)` -- If condition is true, evaluates then; otherwise returns true. Only the chosen branch is evaluated (lazy).
- `if(condition, then, else)` -- If condition is true, evaluates then; otherwise evaluates else. Useful for guarding expressions that access zones conditionally.

### Safety Limits

| Limit              | Value |
|--------------------|-------|
| Max eval depth     | 64    |
| Max AST nodes      | 1000  |
| Max while iterations | 100 |

## Builtin Catalog

### Query Builtins

Pure functions that read state without side effects.

| Builtin                          | Args                | Returns   | Description                                          |
|----------------------------------|---------------------|-----------|------------------------------------------------------|
| `hand_value(zone)`               | zone name           | `number`  | Blackjack hand value with ace optimization (11 or 1) |
| `card_count(zone)`               | zone name           | `number`  | Number of cards in zone                              |
| `sum_card_values(zone, strategy)`| zone name, number   | `number`  | Sum card values using a target threshold strategy    |
| `prefer_high_under(target)`      | number              | `number`  | Returns the target as a strategy descriptor          |
| `all_players_done()`             | none                | `boolean` | Sentinel -- always returns true                      |
| `all_hands_dealt()`              | none                | `boolean` | Sentinel -- always returns true                      |
| `scores_calculated()`            | none                | `boolean` | Sentinel -- always returns true                      |
| `continue_game()`                | none                | `boolean` | Sentinel -- returns true (game continues)            |
| `top_card_suit(zone)`            | zone name           | `string`  | Suit string of the top (first) card in zone          |
| `top_card_rank_name(zone)`       | zone name           | `string`  | Rank string of the top card in zone (e.g., `"A"`)    |
| `has_card_matching_suit(zone, suit)` | zone, string    | `boolean` | True if zone has a card with the given suit          |
| `has_card_matching_rank(zone, rank)` | zone, string    | `boolean` | True if zone has a card with the given rank          |
| `card_matches_top(hand, index, target)` | zone, number, zone | `boolean` | True if card matches target's top by suit or rank |
| `has_playable_card(hand, target)`| zone, zone          | `boolean` | True if hand has any card matching target's top      |
| `turn_direction()`               | none                | `number`  | Current turn direction (1=clockwise, -1=counter)     |
| `get_var(name)`                  | string              | `number`  | Returns the value of a custom variable. Throws if not found. |
| `get_param(name)`                | string              | `string\|number` | Returns the value of an action parameter. Returns 0 if not found. Booleans as 1/0. |

### Effect Builtins

Mutating functions that record effect descriptions for the interpreter to apply.

| Builtin                             | Args                       | Description                                    |
|-------------------------------------|----------------------------|------------------------------------------------|
| `shuffle(zone)`                     | zone name                  | Shuffle cards in zone using seeded PRNG        |
| `deal(from, to, count)`            | zone, zone prefix, number  | Deal count cards to each per-player zone       |
| `draw(from, to, count)`            | zone, zone, number         | Move count cards between zones                 |
| `set_face_up(zone, index, faceUp)` | zone, number, boolean      | Set faceUp on a specific card by index         |
| `reveal_all(zone)`                  | zone name                  | Set faceUp = true on all cards in zone         |
| `end_turn()`                        | none                       | Advance to next player                         |
| `calculate_scores()`                | none                       | Evaluate scoring for each player               |
| `determine_winners()`               | none                       | Set winners based on scores                    |
| `collect_all_to(zone)`             | zone name                  | Collect all cards from all zones into target   |
| `reset_round()`                     | none                       | Increment round, reset scores and player index |
| `reverse_turn_order()`              | none                       | Flip turn direction (clockwise ↔ counterclockwise) |
| `skip_next_player()`                | none                       | Advance player index by one extra step             |
| `set_next_player(index)`            | number                     | Set next player to a specific 0-based index        |
| `set_var(name, value)`              | string, number             | Sets a custom variable to the given value                  |
| `inc_var(name, amount)`             | string, number             | Increments a custom variable by amount (can be negative)   |

## Key Types

### `CardGameRuleset`

The top-level type for a fully parsed `.cardgame.json` file. Contains: `meta`, `deck`, `zones`, `roles`, `initialVariables?`, `phases`, `scoring`, `visibility`, `ui`. Immutable by design.

### `CardGameState`

Complete, serializable state of a game at a point in time. Designed for snapshot + action-log persistence. Includes `sessionId`, `ruleset`, `status`, `players`, `zones`, `currentPhase`, `currentPlayerIndex`, `turnNumber`, `scores`, `variables`, `actionLog`, and a monotonically increasing `version` for optimistic concurrency.

### `CardGameAction`

Discriminated union of 9 action variants: `join`, `leave`, `start_game`, `play_card`, `draw_card`, `declare`, `end_turn`, `advance_phase`, `reset_round`. Each variant carries exactly the data needed with no optional fields. The `declare` variant supports an optional `params` object for passing player choices to effects (e.g., `{ kind: "declare", declaration: "choose_color", params: { color: "red" } }`). Effects can read these values via `get_param("name")`.

### `GameReducer`

```typescript
type GameReducer = (state: CardGameState, action: CardGameAction) => CardGameState
```

### `PlayerView`

Filtered projection of game state for a specific player. Hidden cards are replaced with `null` to prevent information leaks. Includes `isMyTurn`, `myPlayerId`, `validActions`, `variables`, and filtered `zones`.

### `Card` and `CardInstanceId`

`Card` has `id`, `suit`, `rank`, and `faceUp`. `CardInstanceId` is a branded string type (`string & { __brand }`) that uniquely identifies a card instance, even across duplicate ranks/suits in multi-deck games.

### `PlayerId`

Branded string type: `string & { __brand }`.

### `ZoneState`

Runtime state of a zone: its `definition` (name, visibility, owners, maxCards) plus current `cards` array.

### `Phase`, `PhaseAction`, `PhaseTransition`

`PhaseDefinition` has a `name`, `kind` (`automatic | turn_based | all_players`), `actions`, `transitions`, and optional `automaticSequence`/`turnOrder`. `PhaseAction` defines an action with `name`, `label`, optional `condition`, and `effect` expressions. `PhaseTransition` has a `to` phase and a `when` condition.

### `FilteredZoneState`

A zone where hidden cards are replaced with `null` placeholders. Contains `name`, `cards` (with nulls), and `cardCount`.

## Testing

702 tests across 8 test files covering the expression evaluator, builtins, phase machine, action validator, state filter, PRNG, interpreter, and integration scenarios.

```sh
# Run all tests
bunx vitest run

# Watch mode
bunx vitest
```

Test files:

- `src/engine/expression-evaluator.test.ts` -- Tokenizer, parser, evaluator, operator precedence, safety limits
- `src/engine/builtins.test.ts` -- Query and effect builtins, hand value computation
- `src/engine/phase-machine.test.ts` -- Phase transitions, automatic phase execution
- `src/engine/action-validator.test.ts` -- Action validation, turn enforcement, condition evaluation
- `src/engine/state-filter.test.ts` -- Visibility rules, per-player filtering, partial visibility
- `src/engine/prng.test.ts` -- Determinism, distribution, shuffle, pick
- `src/engine/interpreter.test.ts` -- Reducer creation, initial state, action handling
- `src/engine/integration.test.ts` -- Full game flow end-to-end
