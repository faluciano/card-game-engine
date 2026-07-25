// ─── Button ────────────────────────────────────────────────────────
// Web replacement for the host's focusable `Pressable`. The TV host
// drives selection with a D-pad (`onFocus`/`hasTVPreferredFocus`); a
// browser display is pointer/keyboard driven, so this is a real
// <button> that highlights on hover and keyboard focus.

import React, { useState } from "react";
import { colors } from "../theme.js";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  label,
  onPress,
  disabled = false,
  variant = "primary",
  style,
  labelStyle,
}: {
  readonly label: string;
  readonly onPress?: () => void;
  readonly disabled?: boolean;
  readonly variant?: ButtonVariant;
  readonly style?: React.CSSProperties;
  readonly labelStyle?: React.CSSProperties;
}): React.JSX.Element {
  const [active, setActive] = useState(false);
  const highlighted = active && !disabled;

  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      style={{
        ...base,
        ...variants[variant],
        ...(highlighted ? { borderColor: highlightColor[variant] } : null),
        ...(disabled ? disabledStyle : null),
        ...style,
        ...(disabled ? null : { cursor: "pointer" }),
      }}
    >
      <span
        style={{
          ...labelBase,
          ...labelVariants[variant],
          ...(disabled ? { color: colors.textFaint } : null),
          ...labelStyle,
        }}
      >
        {label}
      </span>
    </button>
  );
}

const base: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 12,
  padding: "14px 26px",
  borderWidth: 3,
  borderStyle: "solid",
  borderColor: "transparent",
  font: "inherit",
  transition: "border-color 120ms ease, background-color 120ms ease",
};

const variants: Record<ButtonVariant, React.CSSProperties> = {
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.surfaceRaised },
  danger: { backgroundColor: "transparent", borderColor: colors.danger },
  ghost: { backgroundColor: "transparent" },
};

const highlightColor: Record<ButtonVariant, string> = {
  primary: colors.textBright,
  secondary: colors.textBright,
  danger: colors.danger,
  ghost: colors.accent,
};

const disabledStyle: React.CSSProperties = {
  backgroundColor: colors.border,
  borderColor: "transparent",
  opacity: 0.5,
  cursor: "not-allowed",
};

const labelBase: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  letterSpacing: 0.5,
};

const labelVariants: Record<ButtonVariant, React.CSSProperties> = {
  primary: { color: colors.textBright },
  secondary: { color: colors.textMuted },
  danger: { color: colors.danger },
  ghost: { color: colors.textMuted },
};
