// ─── Room Status Banner ────────────────────────────────────────────
// Tells the room when the relay connection is in trouble. While it is
// reconnecting, phones' moves wait; once the relay has closed the room
// (it expired, or the network was out past the grace period), nothing
// will reach this display again, so offer a fresh room instead of a
// board that silently stopped updating.

import type React from "react";
import type { RelayDisplayStatus } from "@couch-kit/display";
import { colors } from "@card-engine/host-core";
import { Button } from "./Button.js";

export function RoomStatusBanner({
  status,
  onNewRoom,
}: {
  readonly status: RelayDisplayStatus;
  readonly onNewRoom: () => void;
}): React.JSX.Element | null {
  if (status === "reconnecting") {
    return (
      <div role="status" style={{ ...styles.banner, borderColor: colors.warning }}>
        <span style={styles.text}>Connection lost. Reconnecting to the room…</span>
      </div>
    );
  }

  if (status === "closed") {
    return (
      <div role="alert" style={{ ...styles.banner, borderColor: colors.danger }}>
        <span style={styles.text}>
          This room has closed, so phones can't reach it any more. Start a new room and have
          everyone join again.
        </span>
        <Button label="START A NEW ROOM" onPress={onNewRoom} />
      </div>
    );
  }

  return null;
}

const styles = {
  banner: {
    position: "fixed",
    top: 16,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    gap: 16,
    maxWidth: "min(90vw, 760px)",
    padding: "12px 20px",
    backgroundColor: colors.surfaceRaised,
    border: "2px solid",
    borderRadius: 12,
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
  },
  text: {
    color: colors.textBright,
    fontSize: 18,
    lineHeight: 1.4,
  },
} satisfies Record<string, React.CSSProperties>;
