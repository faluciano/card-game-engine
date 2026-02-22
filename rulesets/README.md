# Rulesets

This directory contains example `.cardgame.json` ruleset files.

## Format

Each `.cardgame.json` file defines a complete card game using the Card Game Engine's declarative format. See `packages/shared/src/schema/cardgame.v1.schema.json` for the full JSON Schema.

## Examples

- **blackjack.cardgame.json** — Classic Blackjack (1–6 players vs. dealer)

## Creating Your Own

A ruleset file requires these sections:

| Section | Purpose |
|---|---|
| `meta` | Name, version, author, player count |
| `deck` | Card preset, copies, value mappings |
| `zones` | Named regions where cards reside |
| `roles` | Player and NPC role definitions |
| `phases` | Game flow as a finite state machine |
| `scoring` | How to calculate and compare scores |
| `visibility` | Who can see which cards |
| `ui` | Layout and visual hints for renderers |
