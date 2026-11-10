import React, { useEffect, useMemo, useState } from "react";
import {
  AbsoluteFill,
  Audio,
  CalculateMetadataFunction,
  Img,
  OffthreadVideo,
  Sequence,
  continueRender,
  delayRender,
  getRemotionEnvironment,
  staticFile,
  useVideoConfig,
} from "remotion";
import { getAudioDurationInSeconds } from "@remotion/media-utils";
import { Badge, BadgeText, hasBadgeText } from "./Badge";

/* ================================================================== */
/* Constants (tune these, nothing else) */
/* ================================================================== */
export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
const BG_COLOR = "#0b0b0d";

// CRT frame PNG (native layout, centered on the canvas).
const TV_W = 1500;
const TV_H = 1000;
// Screen rectangle inside the TV PNG, in px of the TV_W x TV_H box.
const SCREEN = { left: 110, top: 140, width: 960, height: 720, radius: 48 };
const CRT_SCANLINES = true;

// Per-shot pacing limits in frames @ 30fps.
const RANGES = {
  INTRO: { min: 60, max: 90, def: 90 }, // 2.0-3.0s per shot
  SEG: { min: 60, max: 90, def: 75 }, // 2.0-3.0s per shot
  BEAT: { min: 90, max: 180, def: 135 }, // 3.0-6.0s per shot
} as const;
const MAX_CUT = 90;

// Audio.
const SFX_VOLUME = Math.pow(10, -13 / 20); // -13 dB = ~0.2239
const FALLBACK_VOICEOVER_FRAMES = 10 * FPS; // 10s preview fallback

/* ================================================================== */
/* Types */
/* ================================================================== */
export type BlockKind = "INTRO" | "SEG" | "BEAT";

export type Shot = {
  id: string;
  file: string | null;
  seconds?: number;
  startFromSec?: number;
  badge?: BadgeText;
  sfx?: { file: string; atFrame?: number };
};

export type Block = {
  kind: BlockKind;
  id: string;
  text?: string;
  shots: Shot[];
};

export type VideoProps = {
  script: Block[];
  voiceoverFile: string;
  voiceoverFrames: number;
  hasVoiceover: boolean;
};

/* ================================================================== */
/* SCRIPT */
/* ================================================================== */
export const SCRIPT: Block[] = [
  {
    kind: "INTRO",
    id: "INTRO",
    shots: [
      { id: "I.1", file: "intro-01.mp4", seconds: 3, badge: { title: "Looney Tunes", subtitle: "1940 - Warner Bros." } },
      { id: "I.2", file: "intro-02.mp4", seconds: 3 },
      { id: "I.3", file: "intro-03.mp4", seconds: 3 },
      { id: "I.4", file: "intro-04.mp4", seconds: 3 },
      { id: "I.5", file: "intro-05.mp4", seconds: 3 },
    ],
  },
  {
    kind: "SEG",
    id: "SEG 1",
    text: "Paste the verbatim voiceover line for segment 1 here.",
    shots: [
      { id: "1.1", file: "seg1-a.mp4", seconds: 2.5, badge: { title: "Rugrats", subtitle: "1991 - Nickelodeon" } },
      { id: "1.2", file: "seg1-b.jpg", seconds: 2.5, sfx: { file: "whoosh.mp3" } },
      { id: "1.3", file: "seg1-c.mp4", seconds: 3 },
    ],
  },
  {
    kind: "BEAT",
    id: "BEAT 1",
    shots: [{ id: "BEAT-1", file: "beat-1.mp4", seconds: 4 }],
  },
  {
    kind: "SEG",
    id: "SEG 2",
    text: "Paste the verbatim voiceover line for segment 2 here.",
    shots: [
      { id: "2.1", file: "seg2-a.mp4", seconds: 2.5, badge: { title: "Tommy Pickles" } },
      { id: "2.2", file: null, seconds: 2.5 },
      { id: "2.3", file: "seg2-c.jpg", seconds: 2 },
    ],
  },
];

export const defaultVideoProps: VideoProps = {
  script: SCRIPT,
  voiceoverFile: "voiceover.mp3",
  voiceoverFrames: FALLBACK_VOICEOVER_FRAMES,
  hasVoiceover: false,
};

/* ================================================================== */
/* Asset probing */
/* ================================================================== */
const assetExists = async (src: string): Promise<boolean> => {
  try {
    const res = await fetch(src, { method: "HEAD" });
    if (!res.ok) return false;
    const type = res.headers.get("content-type") ?? "";
    return !type.includes("text/html");
  } catch {
    return false;
  }
};

const useAssetExists = (src: string | null): boolean | null => {
  const [handle] = useState(() => delayRender(`probe ${src ?? "none"}`));
  const [exists, setExists] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!src) {
      setExists(false);
      continueRender(handle);
      return;
    }
    assetExists(src)
      .then((ok) => {
        if (!cancelled) setExists(ok);
      })
      .finally(() => continueRender(handle));
    return () => {
      cancelled = true;
    };
  }, [src, handle]);

  return exists;
};

/* ================================================================== */
/* Timeline builder */
/* ================================================================== */
type TimelineShot = {
  key: string;
  blockId: string;
  blockKind: BlockKind;
  shot: Shot;
  from: number;
  frames: number;
  mediaType: "video" | "image";
  startFromFrames: number;
  unmuted: boolean;
};

type TimelineBlock = {
  id: string;
  kind: BlockKind;
  from: number;
  frames: number;
  voStart: number;
};

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;
const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

export const buildTimeline = (script: Block[], voiceoverFrames: number) => {
  const shots: TimelineShot[] = [];
  const blocks: TimelineBlock[] = [];
  const warnings: string[] = [];
  let cursor = 0;
  let voCursor = 0;
  let seenNonIntro = false;

  const addBlock = (block: Block) => {
    const range = RANGES[block.kind];
    const blockFrom = cursor;

    if (block.kind === "INTRO" && seenNonIntro) {
      warnings.push(
        `INTRO block "${block.id}" appears after other blocks. INTRO blocks must come first.`
      );
    }
    if (block.kind !== "INTRO") seenNonIntro = true;

    block.shots.forEach((shot) => {
      const requested =
        shot.seconds !== undefined
          ? Math.round(shot.seconds * FPS)
          : range.def;
      const frames = clamp(requested, range.min, range.max);
      if (frames !== requested) {
        warnings.push(
          `Shot ${shot.id} (${block.kind}) requested ${requested}f, clamped to ${frames}f (allowed ${range.min}-${range.max}).`
        );
      }
      shots.push({
        key: `${block.id}-${shot.id}`,
        blockId: block.id,
        blockKind: block.kind,
        shot,
        from: cursor,
        frames,
        mediaType: shot.file && VIDEO_EXT.test(shot.file) ? "video" : "image",
        startFromFrames: Math.round((shot.startFromSec ?? 0) * FPS),
        unmuted: block.kind !== "SEG",
      });
      cursor += frames;
    });

    const frames = cursor - blockFrom;
    blocks.push({
      id: block.id,
      kind: block.kind,
      from: blockFrom,
      frames,
      voStart: voCursor,
    });
    if (block.kind === "SEG") voCursor += frames;
  };

  script.forEach(addBlock);

  const introBlocks = blocks.filter((b) => b.kind === "INTRO");
  const introFrames = introBlocks.reduce((sum, b) => sum + b.frames, 0);
  const introEnd = introBlocks.reduce(
    (end, b) => Math.max(end, b.from + b.frames),
    0
  );

  const firstSeg = blocks.find((b) => b.kind === "SEG");
  if (firstSeg && firstSeg.from !== introEnd) {
    warnings.push(
      `SEG 1 starts at frame ${firstSeg.from} but the intro ends at frame ${introEnd}. The voiceover should start right after the last INTRO block (move any BEAT out of that gap).`
    );
  }

  const remaining = voiceoverFrames - voCursor;
  if (remaining > 0) {
    const count = Math.ceil(remaining / MAX_CUT);
    const base = Math.floor(remaining / count);
    const extra = remaining - base * count;
    const fillerShots: Shot[] = Array.from({ length: count }, (_, i) => ({
      id: `AUTO.${i + 1}`,
      file: null,
      seconds: (base + (i < extra ? 1 : 0)) / FPS,
    }));
    if (base < RANGES.SEG.min) {
      warnings.push(
        `Unmapped voiceover tail is only ${remaining}f. Add scripted SEG shots.`
      );
    }
    const blockFrom = cursor;
    fillerShots.forEach((shot) => {
      const frames = Math.round((shot.seconds ?? 0) * FPS);
      shots.push({
        key: `AUTO-${shot.id}`,
        blockId: "SEG AUTO",
        blockKind: "SEG",
        shot,
        from: cursor,
        frames,
        mediaType: "image",
        startFromFrames: 0,
        unmuted: false,
      });
      cursor += frames;
    });
    blocks.push({
      id: "SEG AUTO",
      kind: "SEG",
      from: blockFrom,
      frames: cursor - blockFrom,
      voStart: voCursor,
    });
    voCursor += cursor - blockFrom;
  } else if (remaining < 0) {
    warnings.push(
      `Scripted SEG shots run ${-remaining}f past the voiceover. The tail will be silent.`
    );
  }

  return {
    shots,
    blocks,
    totalFrames: Math.max(1, cursor),
    introFrames,
    introEnd,
    warnings,
  };
};

/* ================================================================== */
/* Metadata */
/* ================================================================== */
const probeVoiceover = async (file: string) => {
  const fallback = {
    hasVoiceover: false,
    voiceoverFrames: FALLBACK_VOICEOVER_FRAMES,
  };
  const src = staticFile(`audio/${file}`);
  if (!(await assetExists(src))) return fallback;
  try {
    const seconds = await getAudioDurationInSeconds(src);
    if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
    return {
      hasVoiceover: true,
      voiceoverFrames: Math.ceil(seconds * FPS),
    };
  } catch {
    return fallback;
  }
};

export const calculateMetadata: CalculateMetadataFunction<VideoProps> = async ({
  props,
}) => {
  const { hasVoiceover, voiceoverFrames } = await probeVoiceover(
    props.voiceoverFile
  );
  if (!hasVoiceover) {
    console.warn(
      `[CartoonRecap] public/audio/${props.voiceoverFile} not found. Using a silent 10s placeholder for the SEG runway.`
    );
  }
  const timeline = buildTimeline(props.script, voiceoverFrames);
  console.log(
    `[CartoonRecap] Intro: ${timeline.introFrames}f (${(timeline.introFrames / FPS).toFixed(1)}s). Voiceover starts at frame ${timeline.introEnd}. Total: ${timeline.totalFrames}f (${(timeline.totalFrames / FPS).toFixed(1)}s).`
  );
  timeline.warnings.forEach((w) => console.warn(`[CartoonRecap] ${w}`));

  return {
    durationInFrames: timeline.totalFrames,
    fps: FPS,
    width: WIDTH,
    height: HEIGHT,
    props: { ...props, hasVoiceover, voiceoverFrames },
  };
};

/* ================================================================== */
/* Visual Elements & CRT Frame */
/* ================================================================== */
const EmptyScreen: React.FC<{ label: string }> = ({ label }) => {
  const { isStudio } = getRemotionEnvironment();
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#000",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {isStudio ? (
        <div
          style={{
            color: "#555",
            fontFamily: "monospace",
            fontSize: 22,
            textAlign: "center",
          }}
        >
          MISSING SOURCE
          <br />
          {label}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

const SfxPlayer: React.FC<{ file: string }> = ({ file }) => {
  const src = staticFile(`audio/sfx/${file}`);
  const exists = useAssetExists(src);
  if (!exists) return null;
  return <Audio src={src} volume={SFX_VOLUME} />;
};

const ShotView: React.FC<{ item: TimelineShot }> = ({ item }) => {
  const { shot, mediaType, unmuted, startFromFrames, frames } = item;
  const folder = mediaType === "video" ? "clips" : "images";
  const src = shot.file ? staticFile(`${folder}/${shot.file}`) : null;
  const exists = useAssetExists(src);

  const showBadge = exists === true && hasBadgeText(shot.badge);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {exists === null ? null : !exists || !src ? (
        <EmptyScreen label={`${shot.id} ${shot.file ?? "(no file)"}`} />
      ) : mediaType === "video" ? (
        <OffthreadVideo
          src={src}
          startFrom={startFromFrames}
          muted={!unmuted}
          volume={unmuted ? 1 : 0}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <Img
          src={src}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}

      {showBadge ? (
        <Badge
          title={shot.badge?.title}
          subtitle={shot.badge?.subtitle}
          durationInFrames={frames}
        />
      ) : null}

      {shot.sfx ? (
        <Sequence from={shot.sfx.atFrame ?? 0} layout="none">
          <SfxPlayer file={shot.sfx.file} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

const TvFrame: React.FC<{ left: number; top: number }> = ({ left, top }) => {
  const src = staticFile("images/tv-frame.png");
  const exists = useAssetExists(src);
  if (!exists) return null;
  return (
    <Img
      src={src}
      style={{
        position: "absolute",
        left,
        top,
        width: TV_W,
        height: TV_H,
        objectFit: "contain",
        zIndex: 10,
        pointerEvents: "none",
      }}
    />
  );
};

/* ================================================================== */
/* Main Composition */
/* ================================================================== */
export const CartoonRecap: React.FC<VideoProps> = ({
  script,
  voiceoverFile,
  voiceoverFrames,
  hasVoiceover,
}) => {
  const { width, height } = useVideoConfig();

  const timeline = useMemo(
    () => buildTimeline(script, voiceoverFrames),
    [script, voiceoverFrames]
  );

  const tvLeft = Math.round((width - TV_W) / 2);
  const tvTop = Math.round((height - TV_H) / 2);

  return (
    <AbsoluteFill style={{ backgroundColor: BG_COLOR }}>
      {hasVoiceover
        ? timeline.blocks
            .filter(
              (b) =>
                b.kind === "SEG" &&
                b.from >= timeline.introEnd &&
                b.voStart < voiceoverFrames
            )
            .map((b) => (
              <Sequence
                key={`vo-${b.id}-${b.from}`}
                from={b.from}
                durationInFrames={b.frames}
                layout="none"
              >
                <Audio
                  src={staticFile(`audio/${voiceoverFile}`)}
                  startFrom={b.voStart}
                  endAt={b.voStart + b.frames}
                />
              </Sequence>
            ))
        : null}

      <div
        style={{
          position: "absolute",
          left: tvLeft + SCREEN.left,
          top: tvTop + SCREEN.top,
          width: SCREEN.width,
          height: SCREEN.height,
          overflow: "hidden",
          borderRadius: SCREEN.radius,
          backgroundColor: "#000",
          zIndex: 1,
        }}
      >
        {timeline.shots.map((item) => (
          <Sequence
            key={item.key}
            from={item.from}
            durationInFrames={item.frames}
          >
            <ShotView item={item} />
          </Sequence>
        ))}

        {CRT_SCANLINES ? (
          <AbsoluteFill
            style={{
              pointerEvents: "none",
              backgroundImage:
                "repeating-linear-gradient(to bottom, rgba(0,0,0,0.12) 0px, rgba(0,0,0,0.12) 1px, rgba(0,0,0,0) 3px)",
              boxShadow: "inset 0 0 90px rgba(0,0,0,0.55)",
            }}
          />
        ) : null}
      </div>

      <TvFrame left={tvLeft} top={tvTop} />
    </AbsoluteFill>
  );
};

export const FacelessVideo = CartoonRecap;