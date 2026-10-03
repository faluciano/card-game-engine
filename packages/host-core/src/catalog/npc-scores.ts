// ─── NPC Scores from a score record ────────────────────────────────
// `getNpcScores` in game-table-model takes the full CardGameState but
// only reads `scores`. The phone controller holds a PlayerView, so this
// adapter accepts the score record alone and delegates for the labels.

import type { CardGameState } from "@card-engine/shared";
import { getNpcScores, type NpcScoreRow } from "../game-table-model";

/** Non-player "*_score" rows (e.g. "dealer_score" → "Dealer") from a score record. */
export function getNpcScoreRows(scores: Readonly<Record<string, number>>): readonly NpcScoreRow[] {
  const view: Pick<CardGameState, "scores"> = { scores };
  // getNpcScores only touches `.scores`; the cast keeps the state type intact.
  return getNpcScores(view as CardGameState);
}
