// ─── QR Display ────────────────────────────────────────────────────
// Shared QR code component used across host screens to display
// the server URL for phone connections.

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";

// ─── Component ─────────────────────────────────────────────────────

export const QRDisplay = React.memo(function QRDisplay({
  url,
  size = 200,
}: {
  readonly url: string | null;
  readonly size?: number;
}): React.JSX.Element {
  const boxSize = size + 40; // padding around the QR code

  if (!url) {
    return (
      <View style={[styles.qrBox, { width: boxSize, height: boxSize }]}>
        <Text style={styles.qrText}>Starting server…</Text>
      </View>
    );
  }

  return (
    <View style={[styles.qrBox, { width: boxSize, height: boxSize }]}>
      <QRCode
        value={url}
        size={size}
        color="black"
        backgroundColor="white"
      />
    </View>
  );
});

// ─── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  qrBox: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  qrText: {
    color: "#333333",
    fontSize: 16,
    textAlign: "center",
  },
});
