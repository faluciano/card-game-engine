// ─── TV Pressable ──────────────────────────────────────────────────
// The host's D-pad-driven button. Every focusable control on the TV
// needs the same three things: a focus ring that tracks `onFocus` /
// `onBlur`, a disabled state that suppresses the ring, and an
// accessibility role + label for TalkBack. This component owns that so
// the screens don't each re-implement `useState(focused)`. Mirrors
// packages/display/src/components/Button.tsx for the web.

import type React from "react";
import { useState } from "react";
import {
  Pressable,
  type AccessibilityRole,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

// ─── Types ─────────────────────────────────────────────────────────

export interface TVPressableProps extends Omit<PressableProps, "style" | "children"> {
  /** Base style; focus and disabled styles layer on top. */
  readonly style?: StyleProp<ViewStyle>;
  /** Applied while the control holds D-pad focus (and is enabled). */
  readonly focusedStyle?: StyleProp<ViewStyle>;
  /** Applied when `disabled` is true. */
  readonly disabledStyle?: StyleProp<ViewStyle>;
  /** Spoken name for TalkBack; required so no control is announced as "button". */
  readonly accessibilityLabel: string;
  readonly accessibilityRole?: AccessibilityRole;
  readonly children?: React.ReactNode;
}

// ─── Component ─────────────────────────────────────────────────────

export function TVPressable({
  style,
  focusedStyle,
  disabledStyle,
  disabled = false,
  accessibilityRole = "button",
  accessibilityState,
  onFocus,
  onBlur,
  children,
  ...rest
}: TVPressableProps): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  const isDisabled = disabled === true;

  return (
    <Pressable
      {...rest}
      disabled={isDisabled}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled: isDisabled, ...accessibilityState }}
      style={[style, isDisabled && disabledStyle, focused && !isDisabled && focusedStyle]}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
    >
      {children}
    </Pressable>
  );
}
