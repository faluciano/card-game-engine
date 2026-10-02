// ─── @card-engine/shared ───────────────────────────────────────────
// Pure TypeScript game engine. No framework dependencies.
// Re-exports all public types, engine functions, and utilities.
//
// The Zod ruleset schema is deliberately NOT re-exported here: it is only
// reachable through `@card-engine/shared/schema`, so the root entry (and
// everything that imports it — the phone controller, the display, the
// bridge) stays free of Zod. Import `parseRuleset` / `safeParseRuleset` /
// `loadRuleset` from the schema subpath, dynamically where the validation
// is off the hot path.

export * from "./types/index";
export * from "./engine/index";
export * from "./deck/index";
export * from "./bridge/index";
