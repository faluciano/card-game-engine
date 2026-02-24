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
7. [Actions](#7-actions)
   - [play_card Action Kind](#play_card-action-kind)
   - [Declare with Parameters](#declare-with-parameters)
8. [Expressions](#8-expressions)
9. [Turn Order](#9-turn-order)
10. [Custom Variables](#10-custom-variables)
11. [Scoring](#11-scoring)
12. [Visibility](#12-visibility)
13. [UI Hints](#13-ui-hints)
14. [Complete Blackjack Example](#14-complete-blackjack-example)
15. [Validation](#15-validation)
16. [Testing Your Ruleset](#16-testing-your-ruleset)

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
    "preset": "standard_52 | standard_54 | uno_108 | custom",
    "copies": "number (integer >= 1)",
    "cardValues": { "...rank-to-value mappings" }
  },
  "roles": ["...array of role definitions"],
  "zones": ["...array of zone definitions"],
  "initialVariables": { "...optional name-to-number mappings" },
  "phases": ["...array of phase definitions (the FSM)"],
  "scoring": {
    "method": "expression",
    "winCondition": "expression",
    "bustCondition": "expression (optional)"
  },
  "visibility": ["...array of visibility rules"],
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

Three built-in deck presets are available:

| Preset | Cards | Description |
|---|---|---|
| `standard_52` | 52 | 4 suits (hearts, diamonds, clubs, spades) x 13 ranks (A through K) |
| `standard_54` | 54 | Standard 52 + 2 Jokers |
| `uno_108` | 108 | UNO deck: 4 colors x number/action cards + Wild cards |

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
  "zones": [
    { "name": "draw_pile", "visibility": { "kind": "hidden" }, "owners": [] },
    { "name": "hand", "visibility": { "kind": "owner_only" }, "owners": ["player"] },
    { "name": "dealer_hand", "visibility": { "kind": "partial", "rule": "first_card_only" }, "owners": ["dealer"] },
    { "name": "discard", "visibility": { "kind": "public" }, "owners": [] }
  ]
}
```

Each zone definition has:

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Unique identifier. Used in expressions and effect functions. |
| `visibility` | `object` | Default visibility for this zone (see [Visibility](#12-visibility)). |
| `owners` | `string[]` | Role names that own this zone. An empty array means the zone is shared ("house"). |
| `maxCards` | `number?` | Optional card limit for the zone. |

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
| `automatic` | Runs a sequence of effects (`automaticSequence`) then immediately evaluates transitions. Used for dealing, scoring, and AI turns. |
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
  "automaticSequence": [
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
| `automaticSequence` | `string[]?` | Expressions executed in order when an automatic phase is entered. |
| `turnOrder` | `"clockwise" \| "counterclockwise" \| "fixed"?` | Turn order for `turn_based` phases. |

### Transitions

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
are executed automatically. The engine also checks `autoEndTurnCondition` and
evaluates phase transitions after the effects run.

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

---

## 8. Expressions

Expressions are the glue that connects everything. They appear in:
- Phase transition `when` clauses
- Action `condition` fields
- Action `effect` arrays
- Automatic phase `automaticSequence` arrays
- Scoring `method`, `winCondition`, and `bustCondition` fields

The expression language is intentionally constrained -- it is **not**
Turing-complete (except for the bounded `while` loop). No `eval()` or
`Function()` is used; expressions are parsed into an AST and evaluated in a
sandboxed evaluator.

### Operators

| Category | Operators |
|---|---|
| Arithmetic | `+`, `-`, `*`, `/` |
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
| `turn_direction()` | number | Returns the current turn direction: `1` (clockwise) or `-1` (counterclockwise). |
| `get_var(name)` | number | Returns the value of a custom variable. Throws if the variable does not exist. |
| `get_param(name)` | string\|number | Returns the value of an action parameter. Returns 0 if not found. Booleans as 1/0. |
| `count_sets(zone, min_size)` | number | Count rank groups with at least min_size cards. |
| `max_set_size(zone)` | number | Size of the largest rank group (e.g., 4 for four-of-a-kind). |
| `has_flush(zone, min_size)` | boolean | True if any suit has at least min_size cards. |
| `has_straight(zone, length)` | boolean | True if consecutive rank sequence of given length exists. |
| `count_runs(zone, min_length)` | number | Count consecutive rank sequences of at least min_length. |
| `max_run_length(zone)` | number | Length of the longest consecutive rank sequence. |
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
| `set_var(name, value)` | Sets a custom variable to the given numeric value. |
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

Custom variables let rulesets store numeric state that doesn't live in card zones.
Use them for running totals, bid amounts, round counters, or any game-specific
numeric tracking.

### Declaring Initial Variables

Add an optional `initialVariables` field to the top level of your ruleset:

```json
{
  "initialVariables": {
    "running_total": 0,
    "bust_player": -1
  }
}
```

Variables are numeric only (`number` type). They are initialized when the game
starts and reset to their initial values on `reset_round()`.

### Reading Variables

Two ways to read a variable:

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

### Writing Variables

Two effect builtins modify variables:

| Builtin | Description |
|---------|-------------|
| `set_var(name, value)` | Sets a variable to an exact numeric value. |
| `inc_var(name, amount)` | Adds `amount` to the current value. Use negative amounts to subtract. If the variable doesn't exist, starts from 0. |

### Example: Ninety-Nine Running Total

In Ninety-Nine (99), the running total is the core mechanic:

```json
"initialVariables": {
  "running_total": 0,
  "bust_player": -1
}
```

Card effects update the total in the declare action's effect array:

```json
"effect": [
  "set_var(\"bust_player\", current_player_index)",
  "if(card_rank_name(current_player.hand, 0) == \"9\", set_var(\"running_total\", 99))",
  "if(card_rank_name(current_player.hand, 0) == \"10\", inc_var(\"running_total\", -10))",
  "if(card_rank_name(current_player.hand, 0) == \"K\", inc_var(\"running_total\", 0))",
  "..."
]
```

Phase transitions use `get_var()` to check the bust condition:

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

### Variables in Player Views

All variables are included in `PlayerView` — they are global game state visible
to all players. The client can display them (e.g., showing the running total on
the TV screen).

### Reset Behavior

Variables reset to their `initialVariables` values when:
- `reset_round()` is called
- A new round begins via the `handleResetRound` action

If no `initialVariables` are defined, the variables map is empty `{}`.

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

---

## 12. Visibility

Visibility rules control what each player can see. This is how hidden
information works -- other players' hands are hidden, the draw pile is hidden,
and the dealer's hole card is concealed until the appropriate phase.

```json
{
  "visibility": [
    { "zone": "draw_pile", "visibility": { "kind": "hidden" } },
    { "zone": "hand", "visibility": { "kind": "owner_only" } },
    {
      "zone": "dealer_hand",
      "visibility": { "kind": "partial", "rule": "first_card_only" },
      "phaseOverride": {
        "phase": "dealer_turn",
        "visibility": { "kind": "public" }
      }
    },
    { "zone": "discard", "visibility": { "kind": "public" } }
  ]
}
```

### Visibility Kinds

| Kind | Description |
|---|---|
| `public` | All players can see all cards in this zone. |
| `owner_only` | Only the zone's owner can see the cards. Other players see card backs. |
| `hidden` | No one can see the cards (not even the owner). Used for draw piles. |
| `partial` | Some cards are visible according to a `rule` string. |

### Partial Visibility Rules

When `kind` is `"partial"`, the `rule` field specifies which cards are visible:

- `"first_card_only"` -- only the first card in the zone is visible
- Other rules can be defined as the engine evolves

### Phase Overrides

A single `phaseOverride` can change a zone's visibility during a specific phase.
In blackjack, the dealer's hand uses `"partial"` visibility with
`"first_card_only"` by default (the face-up card), but switches to `"public"`
during the `dealer_turn` phase when all cards are revealed.

```json
{
  "zone": "dealer_hand",
  "visibility": { "kind": "partial", "rule": "first_card_only" },
  "phaseOverride": {
    "phase": "dealer_turn",
    "visibility": { "kind": "public" }
  }
}
```

### How Visibility is Enforced

The engine's `createPlayerView()` function filters the full game state for each
player. Hidden cards are replaced with `null` in the player's view, so there is
no way for a client to access hidden information -- it is never sent over the
network.

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
  "deck": {
    "preset": "standard_52",
    "copies": 2,
    "cardValues": {
      "A":  { "kind": "dual", "low": 1, "high": 11 },
      "2":  { "kind": "fixed", "value": 2 },
      "3":  { "kind": "fixed", "value": 3 },
      "4":  { "kind": "fixed", "value": 4 },
      "5":  { "kind": "fixed", "value": 5 },
      "6":  { "kind": "fixed", "value": 6 },
      "7":  { "kind": "fixed", "value": 7 },
      "8":  { "kind": "fixed", "value": 8 },
      "9":  { "kind": "fixed", "value": 9 },
      "10": { "kind": "fixed", "value": 10 },
      "J":  { "kind": "fixed", "value": 10 },
      "Q":  { "kind": "fixed", "value": 10 },
      "K":  { "kind": "fixed", "value": 10 }
    }
  },

  // --- Zones ---
  // Four zones: the shared draw pile and discard, per-player hands,
  // and the dealer's hand.
  "zones": [
    {
      "name": "draw_pile",
      "visibility": { "kind": "hidden" },   // Nobody sees the draw pile
      "owners": []                            // Shared (house) zone
    },
    {
      "name": "hand",
      "visibility": { "kind": "owner_only" }, // Only the owner sees their hand
      "owners": ["player"]                     // Expands to hand:0, hand:1, etc.
    },
    {
      "name": "dealer_hand",
      "visibility": { "kind": "partial", "rule": "first_card_only" },
      "owners": ["dealer"]                     // Single zone, owned by the dealer
    },
    {
      "name": "discard",
      "visibility": { "kind": "public" },     // Everyone can see the discard pile
      "owners": []                             // Shared zone
    }
  ],

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
      "automaticSequence": [
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
      "automaticSequence": [
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
      "automaticSequence": [
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
      "automaticSequence": [
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

  // --- Visibility ---
  // Controls what each player can see per zone, with a phase override
  // for the dealer's hand during the dealer_turn phase.
  "visibility": [
    {
      "zone": "hand",
      "visibility": { "kind": "owner_only" }
    },
    {
      "zone": "dealer_hand",
      "visibility": { "kind": "partial", "rule": "first_card_only" },
      "phaseOverride": {
        "phase": "dealer_turn",
        "visibility": { "kind": "public" }
      }
    },
    {
      "zone": "draw_pile",
      "visibility": { "kind": "hidden" }
    },
    {
      "zone": "discard",
      "visibility": { "kind": "public" }
    }
  ],

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
