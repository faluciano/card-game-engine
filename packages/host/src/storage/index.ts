import { FileRulesetStore } from "./file-ruleset-store";

export { FileRulesetStore } from "./file-ruleset-store";
export type { StoredRuleset } from "./file-ruleset-store";

/**
 * Module-level store instance shared by every host-core hook. The hooks take
 * the store as a dependency, so a single stable instance avoids re-running
 * effects on each render.
 */
export const rulesetStore = new FileRulesetStore();
