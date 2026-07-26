// ─── Join Panel ────────────────────────────────────────────────────
// Web counterpart of the host's QRDisplay: a scannable QR of the
// controller join link plus the room code, so phones can connect from
// any network via the relay.

import React from "react";
import QRCode from "react-qr-code";
import { colors } from "../theme.js";

export const JoinPanel = React.memo(function JoinPanel({
  joinUrl,
  roomId,
  size = 200,
}: {
  readonly joinUrl: string | null;
  readonly roomId: string | null;
  readonly size?: number;
}): React.JSX.Element {
  return (
    <div style={styles.wrap}>
      <div style={{ ...styles.qrBox, width: size + 32, height: size + 32 }}>
        {joinUrl ? (
          <QRCode value={joinUrl} size={size} />
        ) : (
          <span style={styles.qrFallback}>
            {!roomId
              ? "Getting a room code…"
              : "Set VITE_CONTROLLER_URL to show a join QR"}
          </span>
        )}
      </div>
      <div style={styles.codeLabel}>ROOM CODE</div>
      <div style={{ ...styles.code, fontSize: Math.round(size * 0.28) }}>
        {roomId ?? "······"}
      </div>
    </div>
  );
});

const styles = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
  },
  qrBox: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    boxSizing: "border-box",
  },
  qrFallback: {
    color: colors.border,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 1.4,
  },
  codeLabel: {
    color: colors.textDim,
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: 2,
    marginTop: 4,
  },
  code: {
    color: colors.textBright,
    fontWeight: 800,
    letterSpacing: "0.3em",
    // Offset the trailing letter-space so the code stays optically centered.
    textIndent: "0.3em",
    lineHeight: 1.1,
  },
} satisfies Record<string, React.CSSProperties>;
