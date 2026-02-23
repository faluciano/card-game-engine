// ─── Role Utilities ─────────────────────────────────────────────────
// Helpers for role-based player classification.

/**
 * Checks if a player's role is human by looking up the role definition.
 * Uses the ruleset's role definitions rather than hardcoding role names.
 * Defaults to human if the role is not found in the ruleset.
 */
export function isHumanPlayer(
  player: { readonly role: string },
  roles: readonly { readonly name: string; readonly isHuman: boolean }[]
): boolean {
  const role = roles.find((r) => r.name === player.role);
  return role?.isHuman ?? true;
}
