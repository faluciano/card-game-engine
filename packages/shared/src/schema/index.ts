// ─── @card-engine/shared/schema ────────────────────────────────────
// The only entry point that pulls in Zod. Keep it out of the root barrel
// so the web apps can load it on demand (dynamic import) when a user
// installs or imports a ruleset.

export {
  CardGameRulesetSchema,
  loadRuleset,
  parseRuleset,
  safeParseRuleset,
  type ParsedRuleset,
} from "./validation";
