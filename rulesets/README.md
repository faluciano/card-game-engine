# Rulesets

This directory contains example `.cardgame.json` ruleset files that the Card Game Engine can load and play.

## Games

| File | Game | Family | Players |
|------|------|--------|---------|
| `blackjack.cardgame.json` | Blackjack | Banking / dealer vs. players | 1–6 |
| `war.cardgame.json` | War | Rank comparison | 2 |
| `crazy-eights.cardgame.json` | Crazy Eights | Matching / shedding | 2–4 |
| `ninety-nine.cardgame.json` | Ninety-Nine (99) | Accumulation / avoidance | 2–4 |
| `uno.cardgame.json` | Uno (Simplified) | Shedding / color matching | 2–4 |

## Creating Your Own

A ruleset file requires these top-level sections:

| Section | Purpose |
|---------|---------|
| `meta` | Name, version, author, player count |
| `deck` | Card preset or custom card list, value mappings |
| `zones` | Named regions where cards reside |
| `roles` | Player and NPC role definitions |
| `phases` | Game flow as a finite state machine |
| `scoring` | How to calculate and compare scores |
| `visibility` | Who can see which cards |
| `ui` | Layout and visual hints for renderers |

Optional sections: `initialVariables` (custom numeric state).

For the full format specification, expression language reference, and annotated examples, see the **[Ruleset Authoring Guide](../docs/ruleset-authoring.md)**.

Validate your ruleset against the JSON Schema at `packages/schema/src/schema/cardgame.v1.schema.json`.
