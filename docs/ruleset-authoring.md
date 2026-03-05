# Ruleset Authoring Guide

This guide walks through every section of a `.cardgame.json` file and explains
how the Card Game Engine interprets it at runtime. **Blackjack** is used as the
running example throughout.

## Table of Contents

1. [Introduction](#1-introduction)
2. [File Structure Overview](#2-file-structure-overview)
3. [Deck Configuration](#3-deck-configuration)
4. [Roles](#4-roles)
5. [Zones](#5-zones)
6. [Phases (the FSM)](#6-phases-the-fsm)
   - [Phase Lifecycle Hooks (onEnter / onExit)](#phase-lifecycle-hooks-onenter--onexit)
   - [Phase Transitions & Global Transitions](#phase-transitions--global-transitions)
7. [Actions](#7-actions)
   - [play_card Action Kind](#play_card-action-kind)
   - [Declare with Parameters](#declare-with-parameters)
8. [Expressions](#8-expressions)
9. [Turn Order](#9-turn-order)
10. [Custom Variables](#10-custom-variables)
11. [Scoring](#11-scoring)
12. [Zone Visibility & Phase Overrides](#12-zone-visibility--phase-overrides)
13. [UI Hints](#13-ui-hints)
14. [Complete Blackjack Example](#14-complete-blackjack-example)
15. [Validation](#15-validation)
16. [Testing Your Ruleset](#16-testing-your-ruleset)
17. [Trick-Taking Games](#17-trick-taking-games)

---

## 1. Introduction

A `.cardgame.json` file declaratively defines every rule of a card game:
metadata, deck composition, zones where cards can reside, player roles, a
phase-based finite state machine that drives gameplay, scoring logic, and
visibility rules that control hidden information.

The engine loads the ruleset at startup and interprets it at runtime. No code
changes are needed to add a new game -- you write a JSON file, validate it
against the schema, and the engine handles the rest.

**V1 scope** covers turn-based and simultaneous-action card games. The following
are not yet supported:

- Real-time mechanics (e.g., slap games)
- Partnerships / team play
- Recursive sub-games
- Card passing between players outside of zones

---

## 2. File Structure Overview

Every `.cardgame.json` file is a single JSON object with these top-level
sections:

```json
{
  "$schema": "../packages/schema/src/schema/cardgame.v1.schema.json",
  "meta": {
    "name": "string",
    "slug": "string (lowercase, hyphens only)",
    "version": "string (semver: X.Y.Z)",
    "author": "string",
    "players": {
      "min": "number (integer >= 1)",
      "max": "number (integer >= 1)"
    },
    "description": "string (optional — short description of the game)",
    "tags": ["string (optional — searchable tags for catalog browsing)"],
    "license": "string (optional — license identifier, e.g. MIT, public-domain)"
  },
  "deck": {
    "preset": "standard_52 | standard_54 | custom",
    "copies": "number (integer >= 1)",
    "cardValues": { "...rank-to-value mappings" }
  },
  "roles": ["...array of role definitions"],
  "zones": { "...zone name to ZoneConfig mappings (includes phaseOverrides)" },
  "variables": { "...optional variable name to VariableDefinition mappings" },
  "phases": ["...array of phase definitions (the FSM)"],
  "globalTransitions": ["...optional fallback transition rules"],
  "scoring": {
    "method": "expression",
    "winCondition": "expression",
    "bustCondition": "expression (optional)"
  },
  "ui": {
    "layout": "semicircle | circle | grid | linear",
    "tableColor": "felt_green | wood | dark | custom"
  }
}
```

| Field | Required | Description |
|---|---|---|
| `$schema` | No | Root-level field referencing the JSON Schema for editor validation and autocompletion. |
| `meta` | Yes | Metadata block (see below). |
| `deck` … `ui` | Yes | All other top-level sections are required. The schema enforces this at load time. |

For the blackjack ruleset, the `meta` block looks like this:

```json
{
  "$schema": "../packages/schema/src/schema/cardgame.v1.schema.json",
  "meta": {
    "name": "Blackjack",
    "slug": "blackjack",
    "version": "1.0.0",
    "author": "card-engine",
    "players": { "min": 1, "max": 6 },
    "description": "Classic casino banking game — beat the dealer without going over 21.",
    "tags": ["casino", "banking", "classic"],
    "license": "public-domain"
  }
}
```

- `slug` must be lowercase alphanumeric with hyphens only (regex: `^[a-z0-9-]+$`).
- `version` must be a valid semver string (regex: `^\d+\.\d+\.\d+$`).
- `players.min` must be less than or equal to `players.max`.
- `description`, `tags`, and `license` are optional catalog fields used by the `bun run catalog` script to generate a browsable `catalog.json`.

---

## 3. Deck Configuration

The `deck` section defines which cards exist and what they are worth.

```json
{
  "deck": {
    "preset": "standard_52",
    "copies": 2,
    "cardValues": {
      "A": { "kind": "dual", "low": 1, "high": 11 },
      "2": { "kind": "fixed", "value": 2 },
      "3": { "kind": "fixed", "value": 3 },
      "4": { "kind": "fixed", "value": 4 },
      "5": { "kind": "fixed", "value": 5 },
      "6": { "kind": "fixed", "value": 6 },
      "7": { "kind": "fixed", "value": 7 },
      "8": { "kind": "fixed", "value": 8 },
      "9": { "kind": "fixed", "value": 9 },
      "10": { "kind": "fixed", "value": 10 },
      "J": { "kind": "fixed", "value": 10 },
      "Q": { "kind": "fixed", "value": 10 },
      "K": { "kind": "fixed", "value": 10 }
    }
  }
}
```

### Presets

Two built-in deck presets are available:

| Preset | Cards | Description |
|---|---|---|
| `standard_52` | 52 | 4 suits (hearts, diamonds, clubs, spades) x 13 ranks (A through K) |
| `standard_54` | 54 | Standard 52 + 2 Jokers |

### Copies

The `copies` field controls how many complete decks are shuffled together. For
blackjack (which traditionally uses a multi-deck shoe), `"copies": 2` creates
104 cards (2 x 52).

### Card Values

Each rank referenced by the deck must have a value definition in `cardValues`.
Two kinds are supported:

- **`fixed`** -- a single numeric value. Most cards use this.
  ```json
  { "kind": "fixed", "value": 10 }
  ```

- **`dual`** -- two possible values; the engine picks the best one. Used for
  Aces in blackjack: the engine starts with the `high` value and downgrades
  to `low` when the total would exceed the target (21).
  ```json
  { "kind": "dual", "low": 1, "high": 11 }
  ```

- **Numeric shorthand** -- bare numbers are accepted as shorthand for `fixed`
  values. At parse time, `2` normalizes to `{ "kind": "fixed", "value": 2 }`.
  ```json
  "cardValues": {
    "2": 2,
    "3": 3,
    "ace": { "kind": "choice", "options": [1, 11] }
  }
  ```
  This makes simple value mappings much more concise. The object form is still
  supported and required for `dual` or `choice` value kinds.

### Deterministic Card IDs

When the deck is instantiated, each card receives a unique deterministic ID
generated by a seeded PRNG (mulberry32). Given the same seed, the same IDs are
produced every time. This enables deterministic replay from an action log.

---

## 4. Roles

Roles define who participates in the game.

```json
{
  "roles": [
    { "name": "player", "isHuman": true, "count": "per_player" },
    { "name": "dealer", "isHuman": false, "count": 1 }
  ]
}
```

Each role has three fields:

| Field | Type | Description |
|---|---|---|
| `name` | `string` | A unique identifier. Referenced by zones, actions, and visibility rules. |
| `isHuman` | `boolean` | `true` for roles controlled by connected players; `false` for AI-controlled roles (e.g., the dealer). |
| `count` | `number \| "per_player"` | `"per_player"` creates one instance per connected player. A fixed number creates exactly that many. |

In blackjack, every connected human is a `player`, and one AI-controlled
`dealer` is created automatically.

Role names are referenced throughout the ruleset:
- Zones use role names as `owners` to control who has access.
- Visibility rules reference roles to determine who can see which cards.
- The engine uses `isHuman: false` roles to drive automatic AI behavior.

---

## 5. Zones

Zones are named regions where cards reside during a game. Every card is in
exactly one zone at any time.

```json
{
  "zones": {
    "draw_pile": { "visibility": "hidden", "owners": [] },
    "hand": { "visibility": "owner_only", "owners": ["player"] },
    "dealer_hand": {
      "visibility": "partial:first_card_only",
      "owners": ["dealer"],
      "phaseOverrides": { "dealer_turn": "visible" }
    },
    "discard": { "visibility": "visible", "owners": [] }
  }
}
```

Each zone definition has:

| Field | Type | Description |
|---|---|---|
| `name` | `string` | The key in the `zones` object. Used in expressions and effect functions. |
| `visibility` | `string` | Default visibility for this zone (see [Zone Visibility & Phase Overrides](#12-zone-visibility--phase-overrides)). |
| `owners` | `string[]` | Role names that own this zone. An empty array means the zone is shared ("house"). |
| `maxCards` | `number?` | Optional card limit for the zone. |
| `phaseOverrides` | `Record<string, string>?` | Optional map of phase name → visibility override string. |

### Per-Player Zones

When a zone's `owners` array includes a role with `count: "per_player"`, the
engine expands it into one zone per human player at runtime. For example, the
`hand` zone (owned by `"player"`) becomes:

- `hand:0` -- first player's hand
- `hand:1` -- second player's hand
- `hand:2` -- third player's hand

This expansion is automatic. In expressions, you can reference `hand` as a
template name (for effects like `deal()` that operate on all per-player zones)
or `current_player.hand` to get the specific zone for the active player (e.g.,
`"hand:1"`).

### Shared Zones

Zones with an empty `owners` array are shared. In blackjack, `draw_pile` and
`discard` are shared zones accessible to all game logic.

### Zone Name Resolution in Expressions

When you reference a zone name in an expression, it resolves to a string. For
example, `draw_pile` evaluates to `"draw_pile"`. This string is then passed to
builtin functions like `shuffle()`, `deal()`, or `card_count()` which look up
the actual zone contents in the game state.

---

## 6. Phases (the FSM)

The heart of a ruleset is its phase definitions. Phases form a finite state
machine (FSM) that drives the game forward. The engine evaluates transitions
and advances through phases automatically.

Three kinds of phases exist:

| Kind | Description |
|---|---|
| `automatic` | Runs a sequence of effects (`onEnter`) then immediately evaluates transitions. Used for dealing, scoring, and AI turns. |
| `turn_based` | Waits for player input. Players take turns choosing from a set of allowed actions. |
| `all_players` | All players can act concurrently before transitions are evaluated. |

### Phase Structure

```json
{
  "name": "deal",
  "kind": "automatic",
  "actions": [],
  "transitions": [
    { "to": "player_turns", "when": "all_hands_dealt" }
  ],
  "onEnter": [
    "shuffle(draw_pile)",
    "deal(draw_pile, hand, 2)",
    "deal(draw_pile, dealer_hand, 2)",
    "set_face_up(dealer_hand, 0, true)"
  ]
}
```

Every phase has these fields:

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Unique identifier for this phase. Referenced by transitions. |
| `kind` | `"automatic" \| "turn_based" \| "all_players"` | How the phase advances. |
| `actions` | `array` | Available player actions (empty for `automatic` phases). |
| `transitions` | `array` | Ordered list of `{ to, when }` transition rules. |
| `onEnter` | `string[]?` | Expressions executed in order when the phase is entered. Replaces the former `automaticSequence` field. |
| `onExit` | `string[]?` | Expressions executed when the phase is exited (available in schema, **not yet implemented** in the engine). |
| `turnOrder` | `"clockwise" \| "counterclockwise" \| "fixed"?` | Turn order for `turn_based` phases. |
| `autoEndTurnCondition` | `string?` | Expression evaluated after each player action. If `true`, the player's turn ends automatically. Useful for shedding games where playing a card should end the turn. |

### Blackjack Phase Flow

The blackjack ruleset defines five phases forming this FSM:

```
deal -> player_turns -> dealer_turn -> scoring -> round_end
  ^                                                   |
  +---------------------------------------------------+
```

1. **deal** (automatic) -- Shuffles the draw pile, deals 2 cards to each player
   and 2 to the dealer, then sets the dealer's first card face-up.
2. **player_turns** (turn_based) -- Each player chooses to hit, stand, or double
   down. Transitions to `dealer_turn` when all players are done.
3. **dealer_turn** (automatic) -- Reveals the dealer's hand, then draws cards
   while the hand value is under 17. Always transitions to `scoring`.
4. **scoring** (automatic) -- Calculates scores and determines winners.
   Transitions to `round_end`.
5. **round_end** (automatic) -- Collects all cards back to the draw pile and
   resets the round. Transitions back to `deal` if the game should continue.

### Phase Lifecycle Hooks (onEnter / onExit)

When a phase is entered, the engine executes the `onEnter` expressions in order.
This is the primary mechanism for automatic phases (dealing, scoring, AI turns)
but can also be used on `turn_based` or `all_players` phases to run setup logic
before players act.

```json
{
  "name": "deal",
  "kind": "automatic",
  "onEnter": [
    "shuffle(draw_pile)",
    "deal(draw_pile, hand, 2)"
  ],
  "transitions": [{ "to": "player_turns", "when": "all_hands_dealt" }]
}
```

The `onExit` field has the same format as `onEnter` — an array of expression
strings. It is defined in the schema and accepted by the parser, but **not yet
implemented** in the engine. It is reserved for future use (e.g., cleanup logic
when leaving a phase).

```json
{
  "name": "player_turns",
  "kind": "turn_based",
  "onExit": ["set_var(\"turns_taken\", turn_number)"],
  "..."
}
```

> **Migration note:** The field formerly named `automaticSequence` has been
> renamed to `onEnter`. Update existing rulesets accordingly.

### `autoEndTurnCondition` (per-phase)

The `autoEndTurnCondition` field on a `PhaseDefinition` is an expression
evaluated after each player action (including `play_card`). If it evaluates to
`true`, the player's turn ends automatically without requiring an explicit
`end_turn()` call.

```json
{
  "name": "player_turns",
  "kind": "turn_based",
  "autoEndTurnCondition": "hand_count == 0",
  "allowedActions": ["playCard"],
  "transitions": [
    { "to": "scoring", "when": "all_players_done" }
  ]
}
```

This is especially useful for shedding games (Crazy Eights, UNO) where playing
a card should end the turn, or for games where the turn ends when a zone is
empty.

> **Migration note:** `autoEndTurnCondition` was previously located on the
> `scoring` config object. It is now per-phase on `PhaseDefinition`.

### Phase Transitions & Global Transitions

Transitions are evaluated in order. The first one whose `when` expression
evaluates to `true` fires, advancing the game to the `to` phase. If no
transition matches, the phase stays active.

```json
"transitions": [
  { "to": "dealer_turn", "when": "all_players_done" },
  { "to": "scoring", "when": "hand_value(current_player.hand) > 21" }
]
```

**Tip:** If you need a guaranteed fallback transition (for phases that should
always advance), use `"when": "true"` as the last entry:

```json
"transitions": [
  { "to": "scoring", "when": "true" }
]
```

#### `globalTransitions`

The `globalTransitions` field is a new top-level field on `CardGameRuleset`. It
defines phase transitions that are evaluated as a **fallback** after the current
phase's own `transitions` array. If no phase-specific transition matches, the
engine checks `globalTransitions` next.

This is useful for conditions that should trigger a phase change from *any*
phase, such as a game-over check:

```json
{
  "globalTransitions": [
    { "to": "game_over", "condition": "rounds >= max_rounds" },
    { "to": "game_over", "condition": "get_var(\"winner\") > -1" }
  ]
}
```

`globalTransitions` shares the same format as phase-level `transitions` — an
array of `{ to, condition }` objects. Phase-specific transitions always take
priority; global transitions only fire when no phase transition matched.

---

## 7. Actions

Actions define what players can do during `turn_based` or `all_players` phases.
They are nested inside a phase's `actions` array.

```json
{
  "name": "hit",
  "label": "Hit",
  "condition": "hand_value(current_player.hand) < 21",
  "effect": ["draw(draw_pile, current_player.hand, 1)"]
}
```

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Unique identifier for the action within this phase. |
| `label` | `string` | Human-readable label shown in the client UI. |
| `condition` | `string?` | Optional expression. If present, the action is only available when this evaluates to `true`. |
| `effect` | `string[]` | Array of expressions executed in order when the action is triggered. |

### Blackjack Actions

The `player_turns` phase defines three actions:

```json
"actions": [
  {
    "name": "hit",
    "label": "Hit",
    "condition": "hand_value(current_player.hand) < 21",
    "effect": ["draw(draw_pile, current_player.hand, 1)"]
  },
  {
    "name": "stand",
    "label": "Stand",
    "effect": ["end_turn()"]
  },
  {
    "name": "double_down",
    "label": "Double Down",
    "condition": "card_count(current_player.hand) == 2",
    "effect": [
      "draw(draw_pile, current_player.hand, 1)",
      "end_turn()"
    ]
  }
]
```

- **hit**: Available only when the player's hand value is under 21. Draws one
  card from the draw pile into the player's hand.
- **stand**: Always available. Ends the player's turn without drawing.
- **double_down**: Available only on the first action (when the player has
  exactly 2 cards). Draws one card and immediately ends the turn.

When a `condition` is omitted, the action is always available. Effects are
executed sequentially -- `double_down` first draws a card, then ends the turn.

### play_card Action Kind

In addition to `declare`, the engine also recognizes `play_card` as an action
that can trigger phase effects. When a player dispatches a `play_card` action:

```typescript
{ kind: "play_card", playerId: "p1", cardId: "card-42", fromZone: "hand:0", toZone: "discard" }
```

The engine first moves the card from `fromZone` to `toZone` as usual. Then, if
the current phase has a phase action named `"play_card"`, its effect expressions
are executed automatically. The engine also checks the phase's `autoEndTurnCondition`
and evaluates phase transitions after the effects run.

This is the recommended way to combine card movement with game logic. For
example, in a game where playing a card should increment a counter:

```json
{
  "name": "play_card",
  "label": "Play a Card",
  "effect": ["inc_var(\"running_total\", top_card_rank(discard))"]
}
```

When a player plays a card, the card moves to the discard pile, then the
`play_card` action's effects run -- in this case, adding the played card's rank
to the running total.

**Backward compatibility:** If no phase action named `"play_card"` exists in
the current phase, `play_card` behaves as before (card move only). Existing
rulesets are unaffected.

### Declare with Parameters

The `declare` action variant supports an optional `params` object that lets
players pass choices to effects at action time:

```typescript
{ kind: "declare", playerId: "p1", declaration: "choose_color", params: { color: "red" } }
```

Effects can read these parameter values using the `get_param(name)` query
builtin:

```json
{
  "name": "choose_color",
  "label": "Choose Color",
  "effect": ["set_var(\"current_color\", get_param(\"color\"))"]
}
```

`get_param(name)` returns the value of the named parameter as a string or
number. If the parameter is a boolean, it is returned as `1` (true) or `0`
(false). If the parameter does not exist or no params were provided, it returns
`0`.

**Example -- UNO color choice:** When a player plays a Wild card, they must
choose a color. The client sends:

```typescript
{ kind: "declare", playerId: "p1", declaration: "choose_color", params: { color: "blue" } }
```

The phase action's effects read the choice:

```json
"effect": ["set_var(\"wild_color\", get_param(\"color\"))"]
```

Now subsequent matching logic can use `get_var("wild_color")` to check if
played cards match the chosen color.

#### Per-Card Validation

When a `play_card` action has a `condition`, the engine injects `played_card_index`
into the expression context — the index of the card in the player's hand. This
enables per-card validation (e.g., only allow cards matching the discard pile).

Use `played_card_matches_top(zone)` for common suit/rank matching:

```json
{
  "name": "play_card",
  "label": "Play Card",
  "condition": "played_card_index == -1 || played_card_matches_top(discard)"
}
```

The `played_card_index == -1` guard handles the sentinel value used when the engine
checks if the action is generically available (before a specific card is selected).

---

## 8. Expressions

Expressions are the glue that connects everything. They appear in:
- Phase transition `when` clauses
- Action `condition` fields
- Action `effect` arrays
- Phase `onEnter` and `onExit` arrays
- Scoring `method`, `winCondition`, and `bustCondition` fields

The expression language is intentionally constrained -- it is **not**
Turing-complete (except for the bounded `while` loop). No `eval()` or
`Function()` is used; expressions are parsed into an AST and evaluated in a
sandboxed evaluator.

### Operators

| Category | Operators |
|---|---|
| Arithmetic | `+`, `-`, `*`, `/`, `%` |
| Comparison | `==`, `!=`, `<`, `>`, `<=`, `>=` |
| Logic | `&&`, `\|\|`, `!` |
| Unary | `-` (negation), `!` (logical not) |

### Literals

- Numbers: `0`, `42`, `3.14`
- Strings: `"hello"`, `'world'`
- Booleans: `true`, `false`

### Variables

Expressions can reference game state through these built-in bindings:

| Variable | Type | Description |
|---|---|---|
| `current_player` | object | The active player. Access sub-properties like `current_player.hand`. |
| `current_player_index` | number | Index of the active player. |
| `turn_number` | number | Current turn number. |
| `player_count` | number | Total number of connected players. |
| `<zone_name>` | string | Any zone name (e.g., `draw_pile`, `dealer_hand`) resolves to a string. |

The `current_player` object also provides shortcuts to per-player zones. For
example, `current_player.hand` resolves to `"hand:0"` for player 0, `"hand:1"`
for player 1, and so on.

### Builtin Functions

#### Query Builtins (read state, return a value)

| Function | Returns | Description |
|---|---|---|
| `hand_value(zone)` | number | Computes the optimal hand value for cards in the zone, handling dual-value cards (Aces). Uses a target of 21. |
| `hand_value(zone, target)` | number | Same as above but uses a custom target value instead of 21. |
| `card_count(zone)` | number | Returns the number of cards in a zone. |
| `card_rank(zone, index)` | number | Returns the numeric rank value of the card at `index` in `zone`. For dual-value cards, returns the `high` value. |
| `card_suit(zone, index)` | string | Returns the suit string of the card at `index` in `zone`. |
| `card_rank_name(zone, index)` | string | Returns the rank string (e.g., `"A"`, `"K"`, `"7"`) of the card at `index` in `zone`. |
| `count_rank(zone, rank)` | number | Counts how many cards in `zone` have the given rank string. |
| `top_card_rank(zone)` | number | Returns the numeric rank value of the first (top) card in `zone`. Shorthand for `card_rank(zone, 0)`. |
| `max_card_rank(zone)` | number | Returns the highest numeric rank value among all cards in `zone`. Returns 0 for empty zones. |
| `sum_card_values(zone, strategy)` | number | Computes card values with a strategy (use with `prefer_high_under`). |
| `prefer_high_under(target)` | number | Returns a strategy descriptor for `sum_card_values`. |
| `top_card_suit(zone)` | string | Returns the suit string of the top (first) card in a zone. Throws if the zone is empty. |
| `top_card_rank_name(zone)` | string | Returns the rank string (e.g., `"A"`, `"K"`) of the top card in a zone. Throws if the zone is empty. |
| `has_card_matching_suit(zone, suit)` | boolean | True if the zone contains at least one card with the given suit string. |
| `has_card_matching_rank(zone, rank)` | boolean | True if the zone contains at least one card with the given rank string. |
| `card_matches_top(hand_zone, card_index, target_zone)` | boolean | True if the card at `card_index` in `hand_zone` matches the top card of `target_zone` by suit **or** rank. |
| `has_playable_card(hand_zone, target_zone)` | boolean | True if `hand_zone` has any card matching the top card of `target_zone` by suit or rank. Useful for enabling/disabling a "draw" action. |
| `played_card_matches_top(zone)` | boolean | Returns boolean: does the played card match the top of the target zone by suit or rank? Reads `played_card_index` from context. Returns `true` when index is -1 (sentinel). |
| `turn_direction()` | number | Returns the current turn direction: `1` (clockwise) or `-1` (counterclockwise). |
| `get_var(name)` | number | Returns the value of a custom variable. Throws if the variable does not exist. |
| `get_str_var(name)` | string | Returns the value of a string variable. Returns empty string `""` if the variable does not exist. |
| `get_param(name)` | string\|number | Returns the value of an action parameter. Returns 0 if not found. Booleans as 1/0. |
| `count_sets(zone, min_size)` | number | Count rank groups with at least min_size cards. |
| `max_set_size(zone)` | number | Size of the largest rank group (e.g., 4 for four-of-a-kind). |
| `has_flush(zone, min_size)` | boolean | True if any suit has at least min_size cards. |
| `has_straight(zone, length)` | boolean | True if consecutive rank sequence of given length exists. |
| `count_runs(zone, min_length)` | number | Count consecutive rank sequences of at least min_length. |
| `max_run_length(zone)` | number | Length of the longest consecutive rank sequence. |
| `trick_winner(zone_prefix)` | number | Determines the winner of a trick. Compares face-up cards across all `{prefix}:{N}` zones. The led suit comes from the card in `{prefix}:{lead_player}`. If a `trump_suit` variable is set and any player played a trump, the highest trump wins. Otherwise, the highest led-suit card wins. Returns `-1` if no valid cards found. |
| `led_card_suit(zone_prefix)` | string | Returns the suit string of the card played by the lead player. Reads `lead_player` from variables. Returns empty string if lead_player is not set or the zone is empty. |
| `trick_card_count(zone_prefix)` | number | Returns the total number of cards across all `{prefix}:{N}` zones. Used to detect "trick complete" (count equals player_count). |
| `count_cards_by_suit(zone, suit)` | number | Counts cards of a specific suit in a zone. E.g., `count_cards_by_suit("won:0", "hearts")`. |
| `has_card_with(zone, rank, suit)` | boolean | True if the zone contains a card matching both the specified rank AND suit. E.g., `has_card_with("won:0", "Q", "spades")` for Queen of Spades detection. |
| `sum_zone_values_by_suit(zone, suit)` | number | Sums card values for all cards of a specific suit in a zone. Uses `high` value for dual-value cards. |
| `concat(a, b)` | string | Concatenates two values into a string. E.g., `concat("won:", trick_winner("trick"))` produces `"won:2"`. |
| `all_players_done()` | boolean | True when all players have completed their turns. |
| `all_hands_dealt()` | boolean | True after dealing is complete. |
| `scores_calculated()` | boolean | True after scoring is complete. |
| `continue_game()` | boolean | True when the game should continue to another round. |

#### Effect Builtins (modify state)

| Function | Description |
|---|---|
| `shuffle(zone)` | Shuffles all cards in the zone using the seeded PRNG. |
| `deal(from, to, count)` | Deals `count` cards from `from` to each per-player zone matching `to`. |
| `draw(from, to, count)` | Draws `count` cards from `from` into `to` for the current player. |
| `move_top(from, to, count)` | Moves the top `count` cards from `from` zone to `to` zone. Works on any two arbitrary zones (not player-scoped like `draw`). |
| `move_all(from, to)` | Moves all cards from `from` zone to `to` zone. Cards retain their face-up state. |
| `flip_top(zone, count)` | Sets the top `count` cards in `zone` to face-up. |
| `set_face_up(zone, index, bool)` | Sets the face-up state of a specific card in a zone. |
| `reveal_all(zone)` | Sets all cards in a zone to face-up. |
| `end_turn()` | Advances to the next player. |
| `calculate_scores()` | Computes scores for all players using the ruleset's scoring expressions. |
| `determine_winners()` | Evaluates bust/win/tie conditions per player and records results. |
| `collect_all_to(zone)` | Gathers all cards from all zones into the target zone. |
| `reset_round()` | Resets the round: clears scores, resets player index, increments turn. |
| `reverse_turn_order()` | Flips turn direction (clockwise ↔ counterclockwise). Only valid when `effects` collector is available. |
| `skip_next_player()` | Advances the player index by one extra step in the current direction. Only valid when `effects` collector is available. |
| `set_next_player(index)` | Sets the next player to a specific index (0-based). Only valid when `effects` collector is available. |
| `collect_trick(zone_prefix, target_zone)` | Moves all cards from every `{prefix}:{N}` zone into `target_zone`. Cards are set face-down. Used to collect a completed trick into the winner's won pile. |
| `set_lead_player(player_index)` | Sets `variables.lead_player` AND `currentPlayerIndex` to the given player index. The trick winner leads the next trick. |
| `end_game()` | Transitions the game status to `finished`. Derives the winner from `scores[result:N] === 1`. Call after `determine_winners()` in the scoring phase. |
| `set_var(name, value)` | Sets a custom variable to the given numeric value. |
| `set_str_var(name, value)` | Sets a string variable to the given value. |
| `inc_var(name, amount)` | Increments a custom variable by `amount` (can be negative). Creates the variable from 0 if it doesn't exist. |

#### Special Forms

| Form | Description |
|---|---|
| `while(condition, body)` | Repeatedly evaluates `body` while `condition` is true. Bounded to 100 iterations to prevent infinite loops. Effects are flushed between iterations so the condition sees updated state. |
| `if(condition, then)` | If `condition` is true, evaluates `then`; otherwise returns `true`. |
| `if(condition, then, else)` | If `condition` is true, evaluates `then`; otherwise evaluates `else`. |

The `if` form uses **lazy evaluation** -- only the chosen branch is evaluated.
This makes it safe to guard expressions that would fail on missing zones. For
example, checking `player_count > 2` before accessing `hand:2`:

```
if(player_count > 2, card_count("hand:2") == 0, false)
```

Without the `if()` guard, `card_count("hand:2")` would throw in a 2-player
game because the zone does not exist.

The `while` form is essential for the dealer's AI in blackjack:

```
while(hand_value(dealer_hand) < 17, draw(draw_pile, dealer_hand, 1))
```

This draws cards into the dealer's hand one at a time until the hand value
reaches 17 or above. Because effects are flushed between iterations, each
`hand_value()` check sees the newly drawn card.

**Note:** Bare identifiers can also be used as zero-argument function calls in
transition conditions. For example, `"when": "all_players_done"` is equivalent
to `"when": "all_players_done()"`.

---

## 9. Turn Order

The engine supports configurable turn direction for multi-player games. Turn
order is tracked in the game state and can be manipulated at runtime through
effect builtins.

### State: `turnDirection`

Every `CardGameState` has a `turnDirection` field:

- `1` — clockwise (default): players advance `0 → 1 → 2 → ... → 0`
- `-1` — counterclockwise: players advance in reverse `0 → N-1 → N-2 → ... → 0`

When `end_turn()` is called, the engine computes the next player as:

```
nextPlayerIndex = (currentPlayerIndex + turnDirection) mod playerCount
```

### Phase Definition: `turnOrder`

Each `turn_based` phase can declare its initial turn order:

```json
{
  "name": "player_turns",
  "kind": "turn_based",
  "turnOrder": "clockwise",
  "..."
}
```

| Value | Description |
|---|---|
| `"clockwise"` | Players proceed in ascending index order (default). |
| `"counterclockwise"` | Players proceed in descending index order. |
| `"fixed"` | Player order does not change; turn direction effects are ignored. |

### Turn Order Effects

Three effect builtins modify turn order at runtime:

- **`reverse_turn_order()`** — Flips `turnDirection` from `1` to `-1` or vice
  versa. Useful for "reverse" cards (e.g., UNO).
- **`skip_next_player()`** — Advances the player index by one extra step in the
  current direction, effectively skipping the next player.
- **`set_next_player(index)`** — Sets the next player to a specific 0-based
  index. Useful for "pick a player" mechanics.

### Querying Turn Direction

Use `turn_direction()` in conditions or transitions to check the current
direction:

```
if(turn_direction() == -1, "counterclockwise", "clockwise")
```

---

## 10. Custom Variables

Custom variables let rulesets store state that doesn't live in card zones.
Use them for running totals, bid amounts, round counters, suit names, or any
game-specific tracking.

### The `variables` Manifest

Declare variables using the top-level `variables` field. Each key maps to a
`VariableDefinition`:

```json
{
  "variables": {
    "score_0": { "initial": 0, "public": true },
    "score_1": { "initial": 0, "public": true },
    "current_suit": { "initial": "none" },
    "round": { "initial": 1 }
  }
}
```

A `VariableDefinition` has:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `initial` | `number \| string` | Yes | The starting value. Determines the variable type (numeric or string). |
| `public` | `boolean` | No | If `true`, the variable is included in `PlayerView`. Defaults to `false`. |

**Numeric variables** (where `initial` is a number) are read with `get_var(name)`,
written with `set_var(name, value)` and `inc_var(name, amount)`.

**String variables** (where `initial` is a string) are read with `get_str_var(name)`,
written with `set_str_var(name, value)`.

> **Migration note:** The former `initialVariables`, `initialStringVariables`,
> and `publicVariables` fields have been consolidated into the single `variables`
> manifest. Update existing rulesets to use the new format.

### Reading Variables

Two ways to read a numeric variable:

1. **`get_var(name)` builtin** — explicitly reads a variable by name:
   ```
   get_var("running_total") > 99
   ```

2. **Identifier binding** — variable names resolve directly in expressions:
   ```
   running_total > 99
   ```
   Note: if a variable name collides with a zone name or score key, the zone
   or score takes precedence.

For string variables, use `get_str_var(name)`:
```
get_str_var("current_suit") != "none"
```

### Writing Variables

Two effect builtins modify variables:

| Builtin | Description |
|---------|-------------|
| `set_var(name, value)` | Sets a variable to an exact numeric value. |
| `inc_var(name, amount)` | Adds `amount` to the current value. Use negative amounts to subtract. If the variable doesn't exist, starts from 0. |

### Example: Tracking a Running Total

Custom variables are useful for tracking game state that isn't captured by zones or scores. For example, a running total:

```json
"variables": {
  "running_total": { "initial": 0, "public": true }
}
```

Card effects update the total in the declare action's effect array:

```json
"effect": [
  "inc_var(\"running_total\", 10)",
  "end_turn()"
]
```

Phase transitions use `get_var()` to check conditions:

```json
{ "to": "scoring", "when": "get_var(\"running_total\") > 99" }
```

### Variables in Scoring

Variables can appear in scoring expressions:

```json
"scoring": {
  "method": "if(current_player_index == get_var(\"bust_player\"), 0, 1)",
  "winCondition": "my_score > 0"
}
```

### Public Variables

By default, variables are **not** exposed to clients in the `PlayerView`. To
make a variable visible to all players, set `"public": true` in its definition:

```json
{
  "variables": {
    "score": { "initial": 0, "public": true },
    "round": { "initial": 1, "public": true },
    "internal_counter": { "initial": 0 }
  }
}
```

In this example, `score` and `round` are included in the client-facing
`PlayerView`, while `internal_counter` is hidden from all players.

### Variables in Player Views

Only variables marked `"public": true` are included in `PlayerView`. The client
can display them (e.g., showing the running total on the TV screen). Variables
without `"public": true` are hidden from clients.

### Reset Behavior

Variables reset to their `initial` values (from the `variables` manifest) when:
- `reset_round()` is called
- A new round begins via the `handleResetRound` action

If no `variables` are defined, the variables map is empty `{}`.

### String Variables

String variables are declared in the same `variables` manifest by using a
string for the `initial` value:

```json
"variables": {
  "active_suit": { "initial": "" },
  "current_suit": { "initial": "none", "public": true }
}
```

**Builtins:**

| Builtin | Description |
|---------|-------------|
| `get_str_var(name)` | Returns the string value. Returns `""` if the variable doesn't exist. |
| `set_str_var(name, value)` | Sets a string variable to the given value. |

**Example — Crazy Eights suit choosing:**

After a player plays a wild 8, the game transitions to a `choose_suit` phase where
they declare a suit. The declare action sets the string variable:

```json
{
  "name": "choose_hearts",
  "label": "Hearts",
  "effect": ["set_str_var(\"active_suit\", \"Hearts\")", "end_turn()"]
}
```

Subsequent play validation checks the active suit:

```
get_str_var("active_suit") != "" && card_suit(current_player.hand, played_card_index) == get_str_var("active_suit")
```

String variables reset to their `initial` values on `reset_round()`.

---

## 11. Scoring

The `scoring` section defines how winners are determined.

```json
{
  "scoring": {
    "method": "sum_card_values(hand, prefer_high_under(21))",
    "winCondition": "hand_value <= 21 && (hand_value > dealer_value || dealer_value > 21)",
    "bustCondition": "hand_value > 21"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `method` | expression | The scoring expression. Evaluated per player to compute their score. |
| `winCondition` | expression | Expression that determines whether a player wins. |
| `bustCondition` | expression? | Optional expression that determines whether a player has busted. |

In blackjack, the `method` uses `sum_card_values` with the `prefer_high_under`
strategy to compute the best possible hand value without exceeding 21. The
`winCondition` checks that the player has not busted and either beats the dealer
or the dealer has busted.

The actual score calculation in the engine's `calculate_scores()` effect uses
the `computeHandValue()` function, which starts all dual-value cards (Aces) at
their high value and downgrades them one at a time until the total is at or
below the target.

### Multi-Round Scoring

For games played over multiple rounds, the engine supports
accumulated scoring through cumulative score variables:

| Builtin | Args | Returns | Description |
|---------|------|---------|-------------|
| `accumulate_scores()` | 0 | effect | Adds each player's `player_score:{i}` to `variables["cumulative_score_{i}"]` |
| `get_cumulative_score(i)` | 1 | number | Returns `variables["cumulative_score_{i}"]`, defaults to 0 |
| `max_cumulative_score()` | 0 | number | Highest cumulative score across all human players |
| `min_cumulative_score()` | 0 | number | Lowest cumulative score across all human players |

**Pattern**: After `calculate_scores()` computes round scores, call
`accumulate_scores()` to persist them. Use `max_cumulative_score()` in
transition conditions to determine whether the game should end or continue.

```json
{
  "name": "scoring",
  "kind": "automatic",
  "onEnter": [
    "calculate_scores()",
    "accumulate_scores()"
  ],
  "transitions": [
    { "to": "game_over", "when": "max_cumulative_score() >= 100" },
    { "to": "round_end", "when": "max_cumulative_score() < 100" }
  ]
}
```

The `reset_round()` effect automatically preserves all `cumulative_score_*`
variables while resetting everything else to initial values.

For final winner determination with cumulative scores, reference the cumulative
builtins directly in the `winCondition`:

```json
"winCondition": "get_cumulative_score(current_player_index) == min_cumulative_score()"
```

> **Note:** The `autoEndTurnCondition` field was formerly part of the scoring
> config. It has been moved to `PhaseDefinition` — see
> [Phase Lifecycle Hooks](#phase-lifecycle-hooks-onenter--onexit) for details.

---

## 12. Zone Visibility & Phase Overrides

Visibility is now configured **per-zone** in the `zones` definition rather than
as a separate top-level array. Each `ZoneConfig` has a `visibility` field and an
optional `phaseOverrides` map that changes visibility during specific phases.

```json
{
  "zones": {
    "draw_pile": { "visibility": "hidden", "owners": [] },
    "hand": { "visibility": "owner_only", "owners": ["player"], "maxCards": 10 },
    "dealer_hand": {
      "visibility": "partial:first_card_only",
      "owners": ["dealer"],
      "phaseOverrides": { "dealer_turn": "visible" }
    },
    "discard": { "visibility": "visible" }
  }
}
```

### Visibility Values

| Value | Description |
|---|---|
| `"visible"` | All players can see all cards in this zone (formerly `"public"`). |
| `"owner_only"` | Only the zone's owner can see the cards. Other players see card backs. |
| `"hidden"` | No one can see the cards (not even the owner). Used for draw piles. |
| `"count_only"` | Players can see how many cards are in the zone, but not the card faces. |
| `"partial:first_card_only"` | Only the first card in the zone is visible. |

### Phase Overrides (`phaseOverrides`)

The `phaseOverrides` field on a `ZoneConfig` is a map of phase name → visibility
string. During that phase, the zone's visibility changes to the override value.
When the phase ends, visibility reverts to the zone's default.

In blackjack, the dealer's hand uses `"partial:first_card_only"` visibility by
default (the face-up card), but switches to `"visible"` during the `dealer_turn`
phase when all cards are revealed:

```json
"dealer_hand": {
  "visibility": "partial:first_card_only",
  "owners": ["dealer"],
  "phaseOverrides": {
    "dealer_turn": "visible"
  }
}
```

You can override visibility for multiple phases:

```json
"hand": {
  "visibility": "hidden",
  "owners": ["player"],
  "maxCards": 10,
  "phaseOverrides": {
    "showdown": "visible",
    "scoring": "visible"
  }
}
```

### How Visibility is Enforced

The engine's `createPlayerView()` function filters the full game state for each
player. Hidden cards are replaced with `null` in the player's view, so there is
no way for a client to access hidden information — it is never sent over the
network.

> **Migration note:** The top-level `visibility` array has been removed. Zone
> visibility and phase overrides are now configured directly on each zone in
> the `zones` definition.

---

## 13. UI Hints

The `ui` section provides optional layout hints for the client renderer.

```json
{
  "ui": {
    "layout": "semicircle",
    "tableColor": "felt_green"
  }
}
```

| Field | Values | Description |
|---|---|---|
| `layout` | `semicircle`, `circle`, `grid`, `linear` | How player positions are arranged on screen. |
| `tableColor` | `felt_green`, `wood`, `dark`, `custom` | Background theme for the table. |
| `customColor` | string? | A custom color string, used when `tableColor` is `"custom"`. |

These are hints only -- the client can interpret or override them.

---

## 14. Complete Blackjack Example

Below is the full `blackjack.cardgame.json` with annotations explaining each
section.

```jsonc
{
  // --- Metadata ---
  // Identifies the game and sets player count constraints.
  "meta": {
    "name": "Blackjack",
    "slug": "blackjack",
    "version": "1.0.0",
    "author": "card-engine",
    "players": {
      "min": 1,   // At least 1 human player
      "max": 6    // Up to 6 human players against the dealer
    }
  },

  // --- Deck ---
  // Two standard 52-card decks (104 cards total) with blackjack values.
  // Aces are dual-value: 1 or 11, optimized by the engine automatically.
  // Numeric shorthand (e.g., "2": 2) normalizes to { kind: "fixed", value: 2 }.
  "deck": {
    "preset": "standard_52",
    "copies": 2,
    "cardValues": {
      "A":  { "kind": "dual", "low": 1, "high": 11 },
      "2":  2,
      "3":  3,
      "4":  4,
      "5":  5,
      "6":  6,
      "7":  7,
      "8":  8,
      "9":  9,
      "10": 10,
      "J":  10,
      "Q":  10,
      "K":  10
    }
  },

  // --- Zones ---
  // Four zones with visibility configured inline. The dealer's hand has
  // a phaseOverride that reveals all cards during the dealer_turn phase.
  "zones": {
    "draw_pile": {
      "visibility": "hidden",              // Nobody sees the draw pile
      "owners": []                          // Shared (house) zone
    },
    "hand": {
      "visibility": "owner_only",          // Only the owner sees their hand
      "owners": ["player"]                  // Expands to hand:0, hand:1, etc.
    },
    "dealer_hand": {
      "visibility": "partial:first_card_only",
      "owners": ["dealer"],                 // Single zone, owned by the dealer
      "phaseOverrides": { "dealer_turn": "visible" }
    },
    "discard": {
      "visibility": "visible",             // Everyone can see the discard pile
      "owners": []                          // Shared zone
    }
  },

  // --- Roles ---
  // One human role per connected player, plus one AI dealer.
  "roles": [
    { "name": "player", "isHuman": true,  "count": "per_player" },
    { "name": "dealer", "isHuman": false, "count": 1 }
  ],

  // --- Phases ---
  // The FSM that drives the game: deal -> player_turns -> dealer_turn
  // -> scoring -> round_end -> (back to deal).
  "phases": [
    {
      // Phase 1: Deal cards automatically
      "name": "deal",
      "kind": "automatic",
      "actions": [],
      "transitions": [
        { "to": "player_turns", "when": "all_hands_dealt" }
      ],
      "onEnter": [
        "shuffle(draw_pile)",                    // Shuffle the shoe
        "deal(draw_pile, hand, 2)",              // Deal 2 cards to each player
        "deal(draw_pile, dealer_hand, 2)",       // Deal 2 cards to the dealer
        "set_face_up(dealer_hand, 0, true)"      // Flip the dealer's first card face-up
      ]
    },
    {
      // Phase 2: Players take turns choosing actions
      "name": "player_turns",
      "kind": "turn_based",
      "actions": [
        {
          "name": "hit",
          "label": "Hit",
          "condition": "hand_value(current_player.hand) < 21",
          "effect": ["draw(draw_pile, current_player.hand, 1)"]
        },
        {
          "name": "stand",
          "label": "Stand",
          "effect": ["end_turn()"]
        },
        {
          "name": "double_down",
          "label": "Double Down",
          "condition": "card_count(current_player.hand) == 2",
          "effect": [
            "draw(draw_pile, current_player.hand, 1)",
            "end_turn()"
          ]
        }
      ],
      "transitions": [
        { "to": "dealer_turn", "when": "all_players_done" },
        { "to": "scoring", "when": "hand_value(current_player.hand) > 21" }
      ],
      "turnOrder": "clockwise"
    },
    {
      // Phase 3: Dealer draws automatically until reaching 17
      "name": "dealer_turn",
      "kind": "automatic",
      "actions": [],
      "transitions": [
        { "to": "scoring", "when": "hand_value(dealer_hand) >= 17" }
      ],
      "onEnter": [
        "reveal_all(dealer_hand)",
        "while(hand_value(dealer_hand) < 17, draw(draw_pile, dealer_hand, 1))"
      ]
    },
    {
      // Phase 4: Calculate scores and determine winners
      "name": "scoring",
      "kind": "automatic",
      "actions": [],
      "transitions": [
        { "to": "round_end", "when": "scores_calculated" }
      ],
      "onEnter": [
        "calculate_scores()",
        "determine_winners()"
      ]
    },
    {
      // Phase 5: Collect cards and reset for the next round
      "name": "round_end",
      "kind": "automatic",
      "actions": [],
      "transitions": [
        { "to": "deal", "when": "continue_game" }
      ],
      "onEnter": [
        "collect_all_to(draw_pile)",
        "reset_round()"
      ]
    }
  ],

  // --- Scoring ---
  // Best hand value under 21 wins. Player beats dealer if not busted
  // and either has a higher score or the dealer busted.
  "scoring": {
    "method": "sum_card_values(hand, prefer_high_under(21))",
    "winCondition": "hand_value <= 21 && (hand_value > dealer_value || dealer_value > 21)",
    "bustCondition": "hand_value > 21"
  },

  // --- UI Hints ---
  // Layout suggestion for the client renderer.
  "ui": {
    "layout": "semicircle",
    "tableColor": "felt_green"
  }
}
```

---

## 15. Validation

Rulesets are validated at load time using two complementary systems:

### Zod Schema (Runtime)

The primary validation is done with [Zod](https://zod.dev/) schemas. The
`parseRuleset()` function validates the raw JSON and returns a typed
`CardGameRuleset` object, or throws a `ZodError` with detailed issue
descriptions.

```typescript
import { parseRuleset, safeParseRuleset } from "@card-engine/shared";

// Throws on invalid input
const ruleset = parseRuleset(rawJson);

// Non-throwing alternative -- returns a discriminated result
const result = safeParseRuleset(rawJson);
if (result.success) {
  console.log("Valid:", result.data.meta.name);
} else {
  console.error("Issues:", result.error.issues);
}
```

The `loadRuleset()` function wraps `parseRuleset()` with friendlier error
formatting:

```typescript
import { loadRuleset, RulesetParseError } from "@card-engine/shared";

try {
  const ruleset = loadRuleset(rawJson);
} catch (err) {
  if (err instanceof RulesetParseError) {
    // err.issues is a string array like:
    // ["meta.slug: Invalid", "deck.copies: Expected number, received string"]
    console.error(err.issues);
  }
}
```

### JSON Schema (Static / Editor Integration)

A JSON Schema (draft-07) is also available for editor autocompletion and
pre-commit validation:

```
packages/schema/src/schema/cardgame.v1.schema.json
```

You can reference it in your `.cardgame.json` files for editor support:

```json
{
  "$schema": "../packages/schema/src/schema/cardgame.v1.schema.json",
  "meta": { "..." }
}
```

### Common Validation Errors

| Error | Cause |
|---|---|
| `meta.slug: Invalid` | Slug contains uppercase letters or special characters. |
| `meta.version: Invalid` | Version is not in `X.Y.Z` format. |
| `players.min must be <= players.max` | Min player count exceeds max. |
| `deck.preset: Invalid enum value` | Preset name is not one of the three recognized values. |
| `phases: Array must contain at least 1 element(s)` | No phases defined. |

---

## 16. Testing Your Ruleset

You can write tests for your ruleset using the engine's public API. Tests run
with [Vitest](https://vitest.dev/) and use the same engine that runs on the
host device.

### Basic Smoke Test

```typescript
import { describe, it, expect } from "vitest";
import {
  loadRuleset,
  createInitialState,
  createReducer,
  type PlayerId,
  type GameSessionId,
  type Player,
} from "@card-engine/shared";

import blackjackRuleset from "../../rulesets/blackjack.cardgame.json";

describe("Blackjack ruleset", () => {
  const ruleset = loadRuleset(blackjackRuleset);
  const seed = 42;

  const players: Player[] = [
    { id: "p1" as PlayerId, name: "Alice", role: "player", connected: true },
    { id: "p2" as PlayerId, name: "Bob", role: "player", connected: true },
  ];

  it("loads and validates without errors", () => {
    expect(ruleset.meta.name).toBe("Blackjack");
    expect(ruleset.phases).toHaveLength(5);
  });

  it("creates initial state with correct zones", () => {
    const state = createInitialState(
      ruleset,
      "session-1" as GameSessionId,
      players,
      seed
    );

    // Per-player hands are expanded
    expect(state.zones["hand:0"]).toBeDefined();
    expect(state.zones["hand:1"]).toBeDefined();

    // Shared zones exist
    expect(state.zones["draw_pile"]).toBeDefined();
    expect(state.zones["dealer_hand"]).toBeDefined();
    expect(state.zones["discard"]).toBeDefined();

    // All cards start in the draw pile
    expect(state.zones["draw_pile"]!.cards.length).toBe(104); // 2 copies x 52
  });

  it("starts the game and runs the deal phase", () => {
    const reducer = createReducer(ruleset, seed);
    const initial = createInitialState(
      ruleset,
      "session-1" as GameSessionId,
      players,
      seed
    );

    const state = reducer(initial, { kind: "start_game" });

    // After start_game, the automatic deal phase runs:
    // - Draw pile is shuffled
    // - Each player gets 2 cards
    // - Dealer gets 2 cards
    // - Game advances to player_turns
    expect(state.currentPhase).toBe("player_turns");
    expect(state.zones["hand:0"]!.cards).toHaveLength(2);
    expect(state.zones["hand:1"]!.cards).toHaveLength(2);
    expect(state.zones["dealer_hand"]!.cards).toHaveLength(2);
  });
});
```

### Testing Player Actions

```typescript
it("allows a player to hit and draw a card", () => {
  const reducer = createReducer(ruleset, seed);
  const initial = createInitialState(
    ruleset,
    "session-1" as GameSessionId,
    players,
    seed
  );

  // Start the game (runs deal phase)
  let state = reducer(initial, { kind: "start_game" });

  // Player 0 declares "hit"
  state = reducer(state, {
    kind: "declare",
    playerId: "p1" as PlayerId,
    declaration: "hit",
  });

  // Player should now have 3 cards
  expect(state.zones["hand:0"]!.cards).toHaveLength(3);
});
```

### Tips

- Use a fixed `seed` for deterministic results. The same seed always produces
  the same shuffle order and card IDs.
- The `createReducer()` function returns a pure reducer: `(state, action) =>
  newState`. It never mutates the input state.
- Check `state.currentPhase` to verify the FSM is advancing correctly.
- Check `state.scores` after the scoring phase runs to verify win/loss/tie
  results. Scores are keyed as `"player:0"`, `"player:1"`, `"dealer"`, and
  results as `"result:0"` (1 = win, 0 = push, -1 = loss).

---

## 17. Trick-Taking Games

The engine supports trick-taking card games through a set of specialized
builtins. These enable trick-based card games like Spades, Whist, Euchre, and
other trick-taking games.

### Core Concepts

In a trick-taking game:
1. Each player plays one card per trick
2. Players must follow the led suit if they can (follow-suit obligation)
3. The highest card in the led suit wins the trick (unless trumped)
4. The trick winner collects the cards and leads the next trick

### Zone Layout

Trick-taking games typically use three per-player zone types:

| Zone | Visibility | Purpose |
|------|-----------|---------|
| `hand` | owner_only | Player's cards |
| `trick` | public | Current trick (0-1 cards) |
| `won` | hidden | Collected trick cards |

```json
"zones": {
  "draw_pile": { "visibility": "hidden", "owners": [] },
  "hand": { "visibility": "owner_only", "owners": ["player"] },
  "trick": { "visibility": "visible", "owners": ["player"], "maxCards": 1 },
  "won": { "visibility": "hidden", "owners": ["player"] }
}
```

### Required Variables

```json
"variables": {
  "lead_player": { "initial": 0 },
  "tricks_played": { "initial": 0 }
}
```

The `lead_player` variable is **required** -- it is read by `trick_winner()` and
`led_card_suit()` to determine who led the trick.

### Phase Pattern

Trick-taking games use a three-phase loop:

```
setup → play_trick → resolve_trick → play_trick → ... → scoring
```

**setup** (automatic): Shuffle and deal all cards.

```json
{
  "name": "setup",
  "kind": "automatic",
  "actions": [],
  "transitions": [{ "to": "play_trick", "when": "all_hands_dealt" }],
  "onEnter": [
    "shuffle(draw_pile)",
    "deal(draw_pile, hand, 13)",
    "set_lead_player(0)"
  ]
}
```

**play_trick** (turn_based): Players play cards. The lead player goes first
(set by `set_lead_player()`). Each player plays one card from their hand to
their trick zone.

```json
{
  "name": "play_trick",
  "kind": "turn_based",
  "actions": [{
    "name": "play_card",
    "label": "Play Card",
    "effect": ["end_turn()"]
  }],
  "transitions": [
    { "to": "resolve_trick", "when": "trick_card_count(\"trick\") == player_count" }
  ],
  "turnOrder": "clockwise"
}
```

**resolve_trick** (automatic): Determine the winner, collect cards, set up the
next trick.

```json
{
  "name": "resolve_trick",
  "kind": "automatic",
  "actions": [],
  "transitions": [
    { "to": "scoring", "when": "get_var(\"tricks_played\") >= 13" },
    { "to": "play_trick", "when": "get_var(\"tricks_played\") < 13" }
  ],
  "onEnter": [
    "collect_trick(\"trick\", concat(\"won:\", trick_winner(\"trick\")))",
    "set_lead_player(trick_winner(\"trick\"))",
    "inc_var(\"tricks_played\", 1)"
  ]
}
```

The `collect_trick()` builtin moves all cards from `trick:0`, `trick:1`, etc.
into the winner's `won` pile. The `set_lead_player()` builtin sets both the
`lead_player` variable and `currentPlayerIndex`, so the winner leads next.

### Trump Support

To enable trump suits, set a `trump_suit` variable:

```json
"variables": {
  "lead_player": { "initial": 0 },
  "trump_suit_code": { "initial": 0 },
  "tricks_played": { "initial": 0 }
}
```

The `trick_winner()` builtin automatically checks for a `trump_suit` variable.
If it exists and any player played a card of that suit, the highest trump card
wins the trick instead of the highest led-suit card.

### Scoring

For avoidance games, score penalty points per round. The scoring method counts cards taken and checks for specific penalty cards:

```json
"scoring": {
  "method": "count_cards_by_suit(concat(\"won:\", current_player_index), \"hearts\") + if(has_card_with(concat(\"won:\", current_player_index), \"Q\", \"spades\"), 13, 0)",
  "winCondition": "get_cumulative_score(current_player_index) == min_cumulative_score()"
}
```

The `method` computes each round's penalty (hearts taken + 13 for Queen of
Spades). The `winCondition` uses cumulative scores so the player with the lowest
total penalty wins at game end.

For point-based games like Spades, score positively based on tricks won.

### Ending the Game

For multi-round games, separate scoring from game termination. The scoring phase
accumulates round scores and branches based on whether the target has been
reached:

```json
{
  "name": "scoring",
  "kind": "automatic",
  "onEnter": ["calculate_scores()", "accumulate_scores()"],
  "transitions": [
    { "to": "game_over", "when": "max_cumulative_score() >= 100" },
    { "to": "round_end", "when": "max_cumulative_score() < 100" }
  ]
}
```

A dedicated `game_over` phase handles final winner determination:

```json
{
  "name": "game_over",
  "kind": "automatic",
  "onEnter": ["determine_winners()", "end_game()"],
  "transitions": []
}
```

The `round_end` phase lets players start the next round. The `reset_round()`
effect clears round state but preserves `cumulative_score_*` variables:

```json
{
  "name": "round_end",
  "kind": "all_players",
  "actions": [{
    "name": "play_again",
    "label": "Play Again",
    "effect": ["collect_all_to(draw_pile)", "reset_round()"]
  }],
  "transitions": [{ "to": "setup", "when": "continue_game" }]
}
```

The `end_game()` builtin transitions the game status to `finished` and derives
the winner from `scores[result:N]`. The `ResultScreen` on the client
automatically displays when the game ends.

For single-round games, combine everything in one scoring phase:

```json
{
  "name": "scoring",
  "kind": "automatic",
  "onEnter": ["calculate_scores()", "determine_winners()", "end_game()"]
}
```

### Limitations

- **Follow-suit enforcement**: Per-card validation via `played_card_matches_top(zone)` and
  `condition` on `play_card` actions now enables basic suit/rank matching (e.g.,
  Crazy Eights). Full follow-suit rules (must play led suit if able) require
  additional UI-level support or future enhancements.
- **Card passing**: Pre-game card passing is not yet
  supported. Requires a new action type for selecting multiple cards to pass.
