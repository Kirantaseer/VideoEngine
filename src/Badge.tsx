import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/LuckiestGuy";

const { fontFamily } = loadFont();

export type BadgeText = {
  /** Key info line 1, e.g. SHOW NAME or CHARACTER NAME. */
  title?: string | null;
  /** Key info line 2, e.g. "1999 - CARTOON NETWORK". */
  subtitle?: string | null;
};

export type BadgeProps = BadgeText & {
  /** Length of the parent shot in frames (drives the exit fade). */
  durationInFrames: number;
  /** Frames to wait after the cut before appearing. */
  delay?: number;
};

const EXIT_FRAMES = 6;

const clean = (s?: string | null): string => (s ?? "").trim();

/** True only when the sheet supplied at least one non-empty line of text. */
export const hasBadgeText = (badge?: BadgeText | null): boolean =>
  !!badge && (clean(badge.title).length > 0 || clean(badge.subtitle).length > 0);

const outline: React.CSSProperties = {
  color: "#FFFFFF",
  fontFamily: `${fontFamily}, Impact, 'Arial Black', sans-serif`,
  textTransform: "uppercase",
  textAlign: "center",
  WebkitTextStroke: "4px #000000",
  paintOrder: "stroke fill",
  textShadow: "4px 4px 0 #000000",
  letterSpacing: 2,
  lineHeight: 1.05,
};

export const Badge: React.FC<BadgeProps> = ({
  title,
  subtitle,
  durationInFrames,
  delay = 6,
}) => {
  // Hooks first (rules of hooks), then bail out if there is nothing to show.
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleText = clean(title);
  const subtitleText = clean(subtitle);

  // No key info on the sheet -> render NOTHING: no card, no gradient, no space.
  if (!titleText && !subtitleText) {
    return null;
  }

  const enter = spring({
    frame: frame - delay,
    fps,
    config: { damping: 12, stiffness: 180, mass: 0.6 },
  });

  const subEnter = spring({
    frame: frame - delay - (titleText ? 4 : 0),
    fps,
    config: { damping: 14, stiffness: 160, mass: 0.6 },
  });

  const exit = interpolate(
    frame,
    [durationInFrames - EXIT_FRAMES, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const opacity = Math.min(Math.max(enter, 0), 1) * exit;

  // Nothing visible yet (before the delay): keep the screen fully clean.
  if (opacity <= 0.001) {
    return null;
  }

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: "34%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-end",
        // Keep text clear of the CRT's curved corners / bezel.
        paddingBottom: 44,
        paddingLeft: 40,
        paddingRight: 40,
        // Soft legibility shade, only ever drawn together with real text.
        background:
          "linear-gradient(to top, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 100%)",
        opacity,
      }}
    >
      {titleText ? (
        <div
          style={{
            ...outline,
            fontSize: 58,
            transform: `translateY(${interpolate(enter, [0, 1], [30, 0])}px) scale(${interpolate(enter, [0, 1], [0.8, 1])})`,
          }}
        >
          {titleText}
        </div>
      ) : null}
      {subtitleText ? (
        <div
          style={{
            ...outline,
            fontSize: titleText ? 32 : 46,
            marginTop: titleText ? 6 : 0,
            WebkitTextStroke: titleText ? "3px #000000" : "4px #000000",
            textShadow: titleText ? "3px 3px 0 #000000" : "4px 4px 0 #000000",
            opacity: Math.min(Math.max(subEnter, 0), 1),
            transform: `translateY(${interpolate(subEnter, [0, 1], [20, 0])}px)`,
          }}
        >
          {subtitleText}
        </div>
      ) : null}
    </div>
  );
};