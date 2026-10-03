// ─── Role Utilities ─────────────────────────────────────────────────
// Helpers for role-based player classification.

/**
 * Checks if a player's role is human by looking up the role definition.
 * Uses the ruleset's role definitions rather than hardcoding role names.
 *
 * @throws {Error} if the player's role is not declared in `roles`. A player
 *   carrying an undeclared role is a construction bug (zone owners and role
 *   names are cross-checked at ruleset load time), so it fails loud instead
 *   of silently counting the player as human.
 */
export function isHumanPlayer(
  player: { readonly role: string },
  roles: readonly { readonly name: string; readonly isHuman: boolean }[],
): boolean {
  const role = roles.find((r) => r.name === player.role);
  if (!role) {
    const declared = roles.map((r) => `"${r.name}"`).join(", ") || "(none)";
    throw new Error(
      `Unknown role "${player.role}": not declared in ruleset roles. Declared roles: ${declared}`,
    );
  }
  return role.isHuman;
}
