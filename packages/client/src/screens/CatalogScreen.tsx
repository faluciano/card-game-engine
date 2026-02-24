// ─── Catalog Screen ────────────────────────────────────────────────
// Browse and install games from the remote catalog.
// Replaces the WaitingScreen when status === "ruleset_picker".

import React, { useCallback, useState } from "react";
import type { CSSProperties } from "react";
import type {
  CatalogGame,
  CardGameRuleset,
  HostGameState,
  HostAction,
} from "@card-engine/shared";
import { safeParseRuleset } from "@card-engine/shared";
import { useCatalog } from "../hooks/useCatalog.js";
import { GameCard } from "../components/GameCard.js";

const CATALOG_BASE_URL =
  "https://faluciano.github.io/card-game-engine/";

interface CatalogScreenProps {
  readonly state: HostGameState;
  readonly sendAction: (action: HostAction) => void;
}

// ─── Styles ────────────────────────────────────────────────────────

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  animation: "fadeIn 0.3s ease-out",
};

const headerStyle: CSSProperties = {
  padding: "20px 16px 12px",
  fontSize: 24,
  fontWeight: 700,
  color: "var(--color-text)",
};

const listStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "0 16px 24px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const centeredStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  padding: 24,
  textAlign: "center",
  gap: 16,
};

const mutedTextStyle: CSSProperties = {
  fontSize: 15,
  color: "var(--color-text-muted)",
};

const errorTextStyle: CSSProperties = {
  fontSize: 15,
  color: "var(--color-danger)",
};

const retryButtonStyle: CSSProperties = {
  padding: "10px 24px",
  border: "none",
  borderRadius: 999,
  backgroundColor: "var(--color-accent)",
  color: "#fff",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};

const spinnerStyle: CSSProperties = {
  fontSize: 32,
  animation: "spin 1s linear infinite",
};

const errorBannerStyle: CSSProperties = {
  margin: "0 16px 12px",
  padding: "10px 14px",
  borderRadius: 8,
  backgroundColor: "rgba(220, 53, 69, 0.15)",
  color: "var(--color-danger)",
  fontSize: 13,
  textAlign: "center",
};

// ─── Component ─────────────────────────────────────────────────────

export function CatalogScreen({
  state,
  sendAction,
}: CatalogScreenProps): React.JSX.Element {
  const catalog = useCatalog();
  const [installError, setInstallError] = useState<string | null>(null);

  const handleInstall = useCallback(
    async (game: CatalogGame): Promise<void> => {
      setInstallError(null);

      try {
        const url = `${CATALOG_BASE_URL}${game.file}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to download: HTTP ${res.status}`);

        const raw: unknown = await res.json();
        const result = safeParseRuleset(raw);

        if (!result.success) {
          throw new Error("Invalid ruleset format");
        }

        sendAction({
          type: "INSTALL_RULESET",
          ruleset: result.data as CardGameRuleset,
          slug: game.slug,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Installation failed";
        setInstallError(`Could not install ${game.name}: ${message}`);
      }
    },
    [sendAction],
  );

  // ── Loading state ──
  if (catalog.tag === "loading") {
    return (
      <div style={centeredStyle}>
        <span style={spinnerStyle}>{"\u2660"}</span>
        <p style={mutedTextStyle}>Loading games...</p>
      </div>
    );
  }

  // ── Error state ──
  if (catalog.tag === "error") {
    return (
      <div style={centeredStyle}>
        <p style={errorTextStyle}>{catalog.message}</p>
        <button
          type="button"
          style={retryButtonStyle}
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Loaded state ──
  const { games } = catalog;

  return (
    <div style={containerStyle}>
      <h1 style={headerStyle}>Browse Games</h1>

      {installError !== null && (
        <div style={errorBannerStyle}>{installError}</div>
      )}

      <div style={listStyle}>
        {games.map((game) => (
          <GameCard
            key={game.slug}
            game={game}
            isInstalled={state.installedSlugs.includes(game.slug)}
            isPending={state.pendingInstall?.slug === game.slug}
            onInstall={(g) => void handleInstall(g)}
          />
        ))}

        {games.length === 0 && (
          <p style={mutedTextStyle}>No games available yet.</p>
        )}
      </div>
    </div>
  );
}
