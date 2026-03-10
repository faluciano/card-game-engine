// ─── Name Entry Screen ─────────────────────────────────────────────
// Prompts the player to enter their display name before connecting
// to the TV host. Persists the chosen name in localStorage.

import React, { useCallback, useState } from "react";
import type { CSSProperties, FormEvent } from "react";

const MAX_NAME_LENGTH = 20;

interface NameEntryScreenProps {
  readonly onConfirm: (name: string) => void;
}

// ─── Styles ────────────────────────────────────────────────────────

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  padding: 24,
  textAlign: "center",
  animation: "fadeIn 0.3s ease-out",
};

const iconStyle: CSSProperties = {
  fontSize: 48,
  marginBottom: 16,
  opacity: 0.8,
};

const headingStyle: CSSProperties = {
  fontSize: 24,
  fontWeight: 700,
  marginBottom: 24,
};

const formStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 16,
  width: "100%",
  maxWidth: 320,
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "14px 16px",
  fontSize: 18,
  fontWeight: 500,
  textAlign: "center",
  border: "2px solid var(--color-surface-raised)",
  borderRadius: 12,
  backgroundColor: "var(--color-surface)",
  color: "var(--color-text)",
  outline: "none",
  transition: "border-color 0.2s ease",
};

const inputFocusedStyle: CSSProperties = {
  ...inputStyle,
  borderColor: "var(--color-accent)",
};

const charCountStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--color-text-muted)",
  marginTop: -8,
};

const buttonStyle: CSSProperties = {
  width: "100%",
  padding: "14px 24px",
  border: "none",
  borderRadius: 12,
  backgroundColor: "var(--color-accent)",
  color: "#fff",
  fontSize: 16,
  fontWeight: 600,
  cursor: "pointer",
  transition: "opacity 0.2s ease",
};

const buttonDisabledStyle: CSSProperties = {
  ...buttonStyle,
  opacity: 0.4,
  cursor: "not-allowed",
};

// ─── Component ─────────────────────────────────────────────────────

export function NameEntryScreen({
  onConfirm,
}: NameEntryScreenProps): React.JSX.Element {
  const [name, setName] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const trimmed = name.trim();
  const isValid = trimmed.length > 0;

  const handleSubmit = useCallback(
    (e: FormEvent): void => {
      e.preventDefault();
      if (isValid) {
        onConfirm(trimmed);
      }
    },
    [isValid, trimmed, onConfirm],
  );

  return (
    <div style={containerStyle}>
      <div style={iconStyle}>{"\u2660"}</div>
      <h1 style={headingStyle}>What's your name?</h1>

      <form style={formStyle} onSubmit={handleSubmit}>
        <input
          type="text"
          value={name}
          onChange={(e) => {
            const value = e.target.value;
            if (value.length <= MAX_NAME_LENGTH) {
              setName(value);
            }
          }}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="Enter your name"
          autoFocus
          autoComplete="off"
          autoCapitalize="words"
          style={isFocused ? inputFocusedStyle : inputStyle}
        />

        <p style={charCountStyle}>
          {trimmed.length} / {MAX_NAME_LENGTH}
        </p>

        <button
          type="submit"
          disabled={!isValid}
          style={isValid ? buttonStyle : buttonDisabledStyle}
        >
          Join Game
        </button>
      </form>
    </div>
  );
}
